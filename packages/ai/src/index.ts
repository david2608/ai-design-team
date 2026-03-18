import type {
  ArtifactKind,
  ArtifactVisualAsset,
  AttachmentReferenceInput,
  Job,
  JsonObject,
  ProjectSnapshot,
  TelegramBinding,
  TelegramGenerationProvider
} from "@ai-design-team/types";
import type { OpenAiAdapter } from "@ai-design-team/integrations-openai";

export type CreativeIntentFamily =
  | "image_generation"
  | "visual_design"
  | "poster_or_event_design"
  | "packaging_design"
  | "campaign_concept"
  | "landing_page_visual_direction"
  | "brand_visual_direction"
  | "mixed_or_ambiguous";

export interface ArtifactPipelineResult {
  kind: ArtifactKind;
  title: string;
  summary: string;
  format: "markdown" | "visual+markdown";
  body: JsonObject;
  renderedText: string;
}

export type ArtifactPipelineStageId = "intake" | "intent" | "clarify" | "compose" | "render";
export type ArtifactPipelineStageStatus = "queued" | "running" | "completed" | "failed";

export interface ArtifactPipelineStageUpdate {
  id: ArtifactPipelineStageId;
  label: string;
  status: ArtifactPipelineStageStatus;
  detail?: string;
}

export interface ArtifactPipelinePreview {
  title: string;
  recommendedDirection: string;
  bigIdea?: string;
  nextStep?: string;
}

export interface ArtifactGenerationObserver {
  onStageUpdate?(update: ArtifactPipelineStageUpdate): void | Promise<void>;
  onPreview?(preview: ArtifactPipelinePreview): void | Promise<void>;
}

export interface ArtifactGenerationPipeline {
  generate(snapshot: ProjectSnapshot, job: Job, observer?: ArtifactGenerationObserver): Promise<ArtifactPipelineResult>;
}

export interface ArtifactGenerationPipelineInput {
  openAi?: OpenAiAdapter;
  gemini?: GeminiAdapter;
}

export interface GeminiImageGenerationInput {
  prompt: string;
  aspectRatio?: "1:1" | "2:3" | "3:2";
  referenceImages?: AttachmentReferenceInput[];
}

export interface GeminiImageGenerationResult {
  asset: ArtifactVisualAsset;
}

export interface GeminiAdapter {
  provider: "gemini";
  model: string;
  status: "live" | "placeholder";
  generateImage(input: GeminiImageGenerationInput): Promise<GeminiImageGenerationResult | null>;
}

export interface CreateGeminiAdapterInput {
  apiKey?: string;
  imageModel: string;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType?: string;
          data?: string;
        };
      }>;
    };
  }>;
}

interface NormalizedCreativeRequest {
  brief: string;
  latestMessage?: string;
  revisionNote?: string;
  referenceImages: AttachmentReferenceInput[];
  referencePlan?: {
    subjectImage?: AttachmentReferenceInput;
    styleImage?: AttachmentReferenceInput;
    supportingImages: AttachmentReferenceInput[];
    instructions: string[];
    summary?: string;
  };
  previousQuestion?: {
    title?: string;
    options: string[];
  };
  previousArtifact?: {
    title?: string;
    recommendedDirection?: string;
    bigIdea?: string;
    visualDirection?: string;
    layoutIdea?: string;
    copyDirection?: string;
    nextAction?: string;
    assumptions: string[];
  };
}

interface IntentAnalysis {
  family: CreativeIntentFamily;
  secondaryFamily?: CreativeIntentFamily;
  signals: string[];
  isBlocking: boolean;
  blockingReason?: string;
  blockingQuestion?: {
    title: string;
    question: string;
    options: string[];
    needFromYou?: string;
  };
}

const STYLE_CONFLICTS: Array<{
  a: string[];
  b: string[];
  labelA: string;
  labelB: string;
  question: string;
}> = [
  {
    a: ["minimal", "minimalist", "clean", "quiet"],
    b: ["maximal", "maximalist", "busy", "chaotic"],
    labelA: "A - restrained and minimal",
    labelB: "B - bold and maximal",
    question: "Which direction should lead this first pass?"
  },
  {
    a: ["luxury", "premium", "elegant", "refined"],
    b: ["playful", "kid", "cute", "cartoon", "fun"],
    labelA: "A - premium and refined",
    labelB: "B - playful and friendly",
    question: "These point in different directions. Which mood should lead?"
  },
  {
    a: ["dark", "moody", "noir"],
    b: ["bright", "airy", "pastel", "light"],
    labelA: "A - dark and moody",
    labelB: "B - bright and airy",
    question: "Pick the core light mood for the first direction."
  }
];

const GEMINI_IMAGE_TIMEOUT_MS = 20_000;

class LiveGeminiAdapter implements GeminiAdapter {
  readonly provider = "gemini" as const;
  readonly status = "live" as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string
  ) {}

  async generateImage(input: GeminiImageGenerationInput): Promise<GeminiImageGenerationResult | null> {
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: input.prompt }];
    for (const reference of input.referenceImages ?? []) {
      parts.push({
        inlineData: {
          mimeType: reference.mimeType,
          data: reference.base64Data
        }
      });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        method: "POST",
        signal: AbortSignal.timeout(GEMINI_IMAGE_TIMEOUT_MS),
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              parts
            }
          ],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: {
              aspectRatio: input.aspectRatio ?? "2:3"
            }
          }
        })
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gemini image generation failed: ${response.status} ${body}`);
    }

    const result = (await response.json()) as GeminiGenerateContentResponse;
    const responseParts = result.candidates?.[0]?.content?.parts ?? [];
    const image = responseParts.find((part) => typeof part.inlineData?.data === "string")?.inlineData;
    if (!image?.data || !image.mimeType) {
      return null;
    }

    return {
      asset: {
        kind: "photo",
        mimeType: image.mimeType,
        fileName: "design-artifact.png",
        base64Data: image.data,
        source: "gemini",
        prompt: input.prompt
      }
    };
  }
}

class PlaceholderGeminiAdapter implements GeminiAdapter {
  readonly provider = "gemini" as const;
  readonly status = "placeholder" as const;

  constructor(readonly model: string) {}

  async generateImage(): Promise<GeminiImageGenerationResult | null> {
    return null;
  }
}

export function createGeminiAdapter(input: CreateGeminiAdapterInput): GeminiAdapter {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) {
    return new PlaceholderGeminiAdapter(input.imageModel);
  }

  return new LiveGeminiAdapter(apiKey, input.imageModel);
}

function cleanText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : undefined;
}

async function emitStage(
  observer: ArtifactGenerationObserver | undefined,
  update: ArtifactPipelineStageUpdate
): Promise<void> {
  await observer?.onStageUpdate?.(update);
}

async function emitPreview(
  observer: ArtifactGenerationObserver | undefined,
  preview: ArtifactPipelinePreview
): Promise<void> {
  await observer?.onPreview?.(preview);
}

function hashText(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) % 2147483647;
  }

  return hash;
}

function pickOne<T>(items: readonly T[], seed: string): T {
  return items[hashText(seed) % items.length]!;
}

function pickMany<T>(items: readonly T[], count: number, seed: string): T[] {
  const used = new Set<number>();
  const results: T[] = [];
  let index = hashText(seed);

  while (results.length < count && used.size < items.length) {
    const nextIndex = index % items.length;
    if (!used.has(nextIndex)) {
      used.add(nextIndex);
      results.push(items[nextIndex]!);
    }
    index += 7;
  }

  return results;
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

function stripLeadingVerb(text: string): string {
  return text
    .replace(/^(create|design|make|generate|build|develop|craft)\s+/i, "")
    .trim();
}

function shorten(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function extractSubject(text: string): string {
  const stripped = stripLeadingVerb(text);
  return shorten(stripped || text, 52);
}

function hasAny(text: string, values: readonly string[]): boolean {
  return values.some((value) => text.includes(value));
}

function countMatches(text: string, values: readonly string[]): number {
  return values.reduce((count, value) => count + (text.includes(value) ? 1 : 0), 0);
}

function extractAttachmentReferences(job: Job): AttachmentReferenceInput[] {
  const raw = job.input.attachmentReferences;
  if (!Array.isArray(raw)) {
    return [];
  }

  const references: AttachmentReferenceInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.attachmentId !== "string" ||
      typeof candidate.order !== "number" ||
      typeof candidate.kind !== "string" ||
      typeof candidate.mimeType !== "string" ||
      typeof candidate.base64Data !== "string"
    ) {
      continue;
    }

    references.push({
      attachmentId: candidate.attachmentId,
      sourceId: typeof candidate.sourceId === "string" ? candidate.sourceId : undefined,
      order: candidate.order,
      kind: candidate.kind as AttachmentReferenceInput["kind"],
      fileName: typeof candidate.fileName === "string" ? candidate.fileName : undefined,
      mimeType: candidate.mimeType,
      storageKey: typeof candidate.storageKey === "string" ? candidate.storageKey : undefined,
      sizeBytes: typeof candidate.sizeBytes === "number" ? candidate.sizeBytes : undefined,
      role: typeof candidate.role === "string" ? (candidate.role as AttachmentReferenceInput["role"]) : undefined,
      base64Data: candidate.base64Data
    });
  }

  return references.sort((a, b) => a.order - b.order);
}

function inferReferencePlan(
  text: string,
  referenceImages: AttachmentReferenceInput[]
): NormalizedCreativeRequest["referencePlan"] {
  if (referenceImages.length === 0) {
    return undefined;
  }

  if (referenceImages.length === 1) {
    return {
      subjectImage: referenceImages[0],
      supportingImages: [],
      instructions: ["Use the uploaded image as the primary visual source for the generated result."],
      summary: "Use the uploaded image as the hero reference."
    };
  }

  const normalizedText = text.toLowerCase();
  const first = referenceImages[0];
  const second = referenceImages[1];
  const mentionsFirst = hasAny(normalizedText, [
    "1st uploaded",
    "first uploaded",
    "image 1",
    "1st image",
    "first image"
  ]);
  const mentionsSecond = hasAny(normalizedText, [
    "2nd uploaded",
    "second uploaded",
    "image 2",
    "2nd image",
    "second image"
  ]);
  const useSecondAsReference = hasAny(normalizedText, [
    "using all other data from 2nd",
    "all other data from 2nd",
    "from the 2nd",
    "from 2nd image",
    "style from 2nd",
    "layout from 2nd",
    "reference from 2nd",
    "using the second image",
    "use the second image",
    "replace the person"
  ]);

  if ((mentionsFirst && mentionsSecond) || useSecondAsReference) {
    return {
      subjectImage: first,
      styleImage: second,
      supportingImages: referenceImages.slice(2),
      instructions: [
        "Use image 1 as the main subject or person to preserve.",
        "Use image 2 as the visual reference for composition, typography, hierarchy, and supporting content.",
        "Rebuild the result as one coherent design, not as two images placed side by side."
      ],
      summary: "Use image 1 as the hero subject and image 2 as the poster/style reference."
    };
  }

  return {
    subjectImage: first,
    styleImage: second,
    supportingImages: referenceImages.slice(2),
    instructions: [
      "Use the first uploaded image as the hero visual reference.",
      "Use the second uploaded image to influence layout, style, and supporting design cues.",
      "Keep the final result unified and production-like."
    ],
    summary: "Use the uploaded images as subject and design references."
  };
}

function normalizeRequest(snapshot: ProjectSnapshot, job: Job): NormalizedCreativeRequest {
  const brief = cleanText(snapshot.project.brief) ?? snapshot.project.title;
  const latestMessage =
    typeof job.input.messageText === "string"
      ? cleanText(job.input.messageText)
      : undefined;
  const revisionNote =
    typeof job.input.revisionNote === "string"
      ? cleanText(job.input.revisionNote)
      : undefined;
  const previousBody = snapshot.latestVisibleArtifact?.body ?? {};
  const referenceImages = extractAttachmentReferences(job);
  const referencePlan = inferReferencePlan(
    [latestMessage, revisionNote, brief].filter(Boolean).join(" "),
    referenceImages
  );

  return {
    brief,
    latestMessage,
    revisionNote,
    referenceImages,
    referencePlan,
    previousArtifact: snapshot.latestVisibleArtifact
      ? {
          title: snapshot.latestVisibleArtifact.title,
          recommendedDirection:
            typeof previousBody.recommendedDirection === "string" ? previousBody.recommendedDirection : undefined,
          bigIdea: typeof previousBody.bigIdea === "string" ? previousBody.bigIdea : undefined,
          visualDirection: typeof previousBody.visualDirection === "string" ? previousBody.visualDirection : undefined,
          layoutIdea: typeof previousBody.layoutIdea === "string" ? previousBody.layoutIdea : undefined,
          copyDirection: typeof previousBody.copyDirection === "string" ? previousBody.copyDirection : undefined,
          nextAction: typeof previousBody.nextAction === "string" ? previousBody.nextAction : undefined,
          assumptions: Array.isArray(previousBody.assumptions)
            ? previousBody.assumptions.filter((value): value is string => typeof value === "string")
            : []
        }
      : undefined,
    previousQuestion:
      snapshot.latestVisibleArtifact?.kind === "question"
        ? {
            title: snapshot.latestVisibleArtifact.title,
            options: Array.isArray(previousBody.options)
              ? previousBody.options.filter((value): value is string => typeof value === "string")
              : []
          }
        : undefined
  };
}

function resolveClarificationChoice(request: NormalizedCreativeRequest): string | undefined {
  const latest = request.latestMessage?.trim().toUpperCase();
  if (!latest || !request.previousQuestion || !["A", "B", "BOTH", "C"].includes(latest)) {
    return undefined;
  }

  if (latest === "BOTH") {
    return request.previousQuestion.options.join(" + ");
  }

  const indexMap: Record<string, number> = {
    A: 0,
    B: 1,
    C: 2
  };

  const option = request.previousQuestion.options[indexMap[latest]];
  return option ? option.replace(/^[A-Z]\s*-\s*/i, "") : undefined;
}

function getWorkingText(request: NormalizedCreativeRequest, job: Job): string {
  const clarificationChoice = resolveClarificationChoice(request);
  const parts = [
    request.latestMessage,
    request.revisionNote ? `Revision note: ${request.revisionNote}` : undefined,
    clarificationChoice ? `Clarified direction: ${clarificationChoice}` : undefined,
    request.brief
  ].filter(Boolean);

  const combined = parts.join(" ");
  if (job.type === "artifact_revision" && request.revisionNote) {
    return `${combined} ${request.revisionNote}`;
  }

  return combined;
}

function inferIntentFamily(request: NormalizedCreativeRequest, job: Job): IntentAnalysis {
  const workingText = getWorkingText(request, job).toLowerCase();
  const clarificationChoice = resolveClarificationChoice(request);
  const scores: Record<CreativeIntentFamily, number> = {
    image_generation: 0,
    visual_design: 0,
    poster_or_event_design: 0,
    packaging_design: 0,
    campaign_concept: 0,
    landing_page_visual_direction: 0,
    brand_visual_direction: 0,
    mixed_or_ambiguous: 0
  };

  scores.image_generation += countMatches(workingText, [
    "dragon",
    "portrait",
    "illustration",
    "scene",
    "fantasy",
    "cinematic",
    "watercolor",
    "photoreal",
    "playing in water",
    "character",
    "creature"
  ]);

  scores.visual_design += countMatches(workingText, [
    "design",
    "visual",
    "art direction",
    "look and feel",
    "concept board",
    "direction"
  ]);

  scores.poster_or_event_design += countMatches(workingText, [
    "poster",
    "event",
    "lesson",
    "festival",
    "concert",
    "workshop",
    "flyer",
    "exhibition",
    "launch party"
  ]);

  scores.packaging_design += countMatches(workingText, [
    "packaging",
    "box",
    "label",
    "bottle",
    "jar",
    "wrapper",
    "carton",
    "chocolate",
    "tea tin"
  ]);

  scores.campaign_concept += countMatches(workingText, [
    "campaign",
    "launch",
    "ad concept",
    "promotion",
    "social series",
    "billboard",
    "activation",
    "rollout"
  ]);

  scores.landing_page_visual_direction += countMatches(workingText, [
    "landing page",
    "hero section",
    "hero",
    "homepage",
    "website",
    "web direction",
    "site"
  ]);

  scores.brand_visual_direction += countMatches(workingText, [
    "brand",
    "branding",
    "identity",
    "logo",
    "palette",
    "visual identity",
    "brand world"
  ]);

  if (workingText.split(/\s+/).length <= 6 && !hasAny(workingText, ["poster", "packaging", "landing", "brand", "campaign"])) {
    scores.image_generation += 2;
  }

  if (scores.poster_or_event_design > 0 && scores.packaging_design > 0) {
    scores.mixed_or_ambiguous += 3;
  }

  if (scores.brand_visual_direction > 0 && scores.landing_page_visual_direction > 0) {
    scores.mixed_or_ambiguous += 2;
  }

  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([family, score]) => ({
      family: family as CreativeIntentFamily,
      score
    }));

  const primary = sorted[0]!;
  const secondary = sorted[1]!;
  const subject = extractSubject(request.latestMessage ?? request.brief).toLowerCase();

  for (const conflict of STYLE_CONFLICTS) {
    if (clarificationChoice) {
      break;
    }

    if (hasAny(workingText, conflict.a) && hasAny(workingText, conflict.b)) {
      return {
        family: primary.score > 0 ? primary.family : "mixed_or_ambiguous",
        secondaryFamily: secondary.score > 0 ? secondary.family : undefined,
        signals: ["style_conflict"],
        isBlocking: true,
        blockingReason: conflict.question,
        blockingQuestion: {
          title: "One quick direction choice",
          question: conflict.question,
          options: [conflict.labelA, conflict.labelB, "BOTH - keep both and show the tension on purpose"],
          needFromYou: "Reply with A, B, or BOTH."
        }
      };
    }
  }

  if (primary.score === 0 && subject.split(/\s+/).length < 2) {
    return {
      family: "mixed_or_ambiguous",
      signals: ["too_vague"],
      isBlocking: true,
      blockingReason: "The request is too open to generate a useful first pass.",
      blockingQuestion: {
        title: "Need one concrete anchor",
        question: "What should this first pass focus on?",
        options: [
          "A - image prompt",
          "B - poster or design direction",
          "C - landing page or brand direction"
        ],
        needFromYou: "Reply with one option and the subject."
      }
    };
  }

  if (primary.score > 0 && secondary.score > 0 && primary.score === secondary.score) {
    return {
      family: "mixed_or_ambiguous",
      secondaryFamily: secondary.family,
      signals: ["split_intent"],
      isBlocking: true,
      blockingReason: "The request is split across two equally strong design paths.",
      blockingQuestion: {
        title: "Choose the first track",
        question: "Which should I lead with first?",
        options: [
          `A - ${primary.family.replace(/_/g, " ")}`,
          `B - ${secondary.family.replace(/_/g, " ")}`,
          "BOTH - combine them into one first pass"
        ],
        needFromYou: "Reply A, B, or BOTH."
      }
    };
  }

  return {
    family: primary.score > 0 ? primary.family : "visual_design",
    secondaryFamily: secondary.score > 0 ? secondary.family : undefined,
    signals: sorted.filter((entry) => entry.score > 0).map((entry) => entry.family),
    isBlocking: false
  };
}

function buildAssumptions(request: NormalizedCreativeRequest, family: CreativeIntentFamily): string[] {
  const text = getWorkingText(request, { type: "artifact_generation" } as Job).toLowerCase();
  const assumptions: string[] = [];

  if (request.referencePlan?.summary) {
    assumptions.push(request.referencePlan.summary);
  }

  if (family === "image_generation" && !hasAny(text, ["portrait", "square", "vertical", "wide"])) {
    assumptions.push("Assuming a portrait-friendly composition with one dominant focal subject.");
  }

  if (family === "poster_or_event_design" && !hasAny(text, ["instagram", "print", "a3", "flyer"])) {
    assumptions.push("Assuming this should work as both a social poster and a printable event visual.");
  }

  if (family === "packaging_design" && !hasAny(text, ["shelf", "retail", "gift"])) {
    assumptions.push("Assuming this needs to feel shelf-ready and premium enough to photograph well.");
  }

  if (family === "landing_page_visual_direction" && !hasAny(text, ["mobile", "desktop", "app"])) {
    assumptions.push("Assuming the hero needs to read clearly on mobile first and still scale to desktop.");
  }

  if (family === "brand_visual_direction" && !hasAny(text, ["audience", "for kids", "for founders", "luxury buyers"])) {
    assumptions.push("Assuming the audience expects a polished, contemporary visual system.");
  }

  if (family === "campaign_concept" && !hasAny(text, ["channel", "social", "outdoor", "email"])) {
    assumptions.push("Assuming the idea should stretch across social, launch assets, and one hero image.");
  }

  if (assumptions.length === 0) {
    assumptions.push("Assuming we should move fast with a strong first pass instead of waiting for more detail.");
  }

  return assumptions.slice(0, 3);
}

function deriveMoodPhrases(family: CreativeIntentFamily, seed: string): {
  direction: string;
  bigIdea: string;
  visualDirection: string;
} {
  const variants: Record<Exclude<CreativeIntentFamily, "mixed_or_ambiguous">, Array<{
    direction: string;
    bigIdea: string;
    visualDirection: string;
  }>> = {
    image_generation: [
      {
        direction: "Lush cinematic fantasy with strong motion and rich light contrast.",
        bigIdea: "Turn the subject into one unforgettable moment instead of a generic scene.",
        visualDirection: "Use one dominant subject, atmospheric depth, water or light energy trails, and a tactile finish."
      },
      {
        direction: "Painterly wonder with premium detail and a slightly mythic tone.",
        bigIdea: "Make the image feel collected, not merely generated.",
        visualDirection: "Favor layered texture, selective glow, and a clear hero silhouette against a spacious backdrop."
      }
    ],
    visual_design: [
      {
        direction: "A sharp, modern visual system with one memorable focal move.",
        bigIdea: "Build one strong visual idea that can carry the whole direction.",
        visualDirection: "Anchor the composition with a bold hero element, disciplined spacing, and a limited but intentional palette."
      },
      {
        direction: "Confident editorial design with premium contrast and breathing room.",
        bigIdea: "Let hierarchy do the persuasion instead of decoration.",
        visualDirection: "Use scale contrast, restrained color blocking, and one expressive material or texture cue."
      }
    ],
    poster_or_event_design: [
      {
        direction: "A poster that feels immediate from a distance and rich up close.",
        bigIdea: "Sell the event through one striking mood before the details land.",
        visualDirection: "Pair a bold title block with a dramatic hero visual and a tight information band."
      },
      {
        direction: "Expressive event graphics with a cultured, art-forward feel.",
        bigIdea: "Make the poster feel collectible, not disposable.",
        visualDirection: "Mix a strong central visual, tactile texture, and a disciplined event-info column."
      }
    ],
    packaging_design: [
      {
        direction: "Premium shelf presence with a clear signature detail.",
        bigIdea: "Make the pack look giftable before anyone reads the label.",
        visualDirection: "Lead with tactile color, a refined front panel, and one memorable finishing cue."
      },
      {
        direction: "Elegant packaging with contemporary restraint and appetite appeal.",
        bigIdea: "Balance desire and clarity so the product feels elevated but easy to trust.",
        visualDirection: "Use a quiet base palette, strong product naming, and a single indulgent accent."
      }
    ],
    campaign_concept: [
      {
        direction: "A campaign world built around one repeatable visual hook.",
        bigIdea: "Create one visual mechanic that can scale across every touchpoint.",
        visualDirection: "Keep the hero gesture simple, repeatable, and unmistakable across image, headline, and motion."
      },
      {
        direction: "A launch direction with editorial confidence and commercial clarity.",
        bigIdea: "Give the campaign a distinct point of view instead of a generic promotion look.",
        visualDirection: "Use one iconic frame, disciplined typography, and a campaign line that travels well."
      }
    ],
    landing_page_visual_direction: [
      {
        direction: "A hero-first web direction that explains value in one glance.",
        bigIdea: "Let the first screen do the selling before anyone scrolls.",
        visualDirection: "Pair a powerful headline zone with a clean visual proof area and one strong accent color."
      },
      {
        direction: "Polished web art direction with product clarity and emotional lift.",
        bigIdea: "Blend conversion clarity with a memorable visual mood.",
        visualDirection: "Use a calm structure, one premium graphic motif, and contrast that guides the eye instantly."
      }
    ],
    brand_visual_direction: [
      {
        direction: "A brand world with clear codes, not just a logo moodboard.",
        bigIdea: "Own a specific visual territory that feels recognizable at a glance.",
        visualDirection: "Define a signature palette, typographic attitude, and one distinctive graphic behavior."
      },
      {
        direction: "A premium identity direction with strong visual discipline.",
        bigIdea: "Make the brand feel intentional, self-assured, and easy to extend.",
        visualDirection: "Use a restrained system, precise spacing, and one standout signature flourish."
      }
    ]
  };

  const familyVariants = variants[family === "mixed_or_ambiguous" ? "visual_design" : family];
  return pickOne(familyVariants, seed);
}

function buildImagePrompt(subject: string, mood: string, revisionNote?: string): string {
  const parts = [
    subject,
    mood,
    "high detail",
    "strong focal composition",
    "cinematic light",
    "rich material texture",
    "premium color separation"
  ];

  if (revisionNote) {
    parts.push(`refined with: ${revisionNote}`);
  }

  return parts.join(", ");
}

function buildStyleOptions(family: CreativeIntentFamily, seed: string): string[] {
  const optionsByFamily: Record<CreativeIntentFamily, string[]> = {
    image_generation: [
      "Painterly fantasy with luminous water texture",
      "Cinematic concept art with high contrast light",
      "Soft editorial illustration with premium detail"
    ],
    visual_design: [
      "Quiet editorial",
      "Bold graphic minimal",
      "Textured contemporary craft"
    ],
    poster_or_event_design: [
      "Cultural poster with tactile typography",
      "High-contrast modern event flyer",
      "Handcrafted art-school poster mood"
    ],
    packaging_design: [
      "Luxury restraint",
      "Artisan premium",
      "Modern indulgence"
    ],
    campaign_concept: [
      "Editorial launch world",
      "Sharp social-first concept",
      "Bold campaign signature"
    ],
    landing_page_visual_direction: [
      "Product clarity with subtle atmosphere",
      "Premium modern landing hero",
      "Editorial web showcase"
    ],
    brand_visual_direction: [
      "Refined brand system",
      "Expressive boutique identity",
      "Contemporary prestige"
    ],
    mixed_or_ambiguous: [
      "Hybrid visual system",
      "Bold combined direction",
      "Split concept exploration"
    ]
  };

  return pickMany(optionsByFamily[family], 3, seed);
}

function buildAlternatives(family: CreativeIntentFamily, subject: string, seed: string): string[] {
  const optionsByFamily: Record<CreativeIntentFamily, string[]> = {
    image_generation: [
      `Push it darker and more mythic around ${subject}.`,
      `Make it softer and more dreamlike with airier color.`,
      `Turn it into a close-up hero with stronger texture detail.`
    ],
    visual_design: [
      "Strip the palette back and let typography lead.",
      "Introduce one more tactile material cue for depth.",
      "Push the focal element larger and more iconic."
    ],
    poster_or_event_design: [
      "Center the hero visual and stack the event details below.",
      "Turn it into a type-led poster with a quieter image field.",
      "Use a more handcrafted art-class tone with warmer texture."
    ],
    packaging_design: [
      "Go darker and more giftable for premium shelf impact.",
      "Lean more artisanal with softer texture and quieter type.",
      "Make the front panel bolder for faster retail recognition."
    ],
    campaign_concept: [
      "Make the campaign line more provocative and editorial.",
      "Push the system toward motion-friendly social fragments.",
      "Reduce the visual palette and make one motif iconic."
    ],
    landing_page_visual_direction: [
      "Make the hero more conversion-focused with clearer proof.",
      "Go moodier and more editorial for higher brand presence.",
      "Use a lighter product showcase with stronger interface clarity."
    ],
    brand_visual_direction: [
      "Tighten it into a quieter premium system.",
      "Add more personality through graphic rhythm and color contrast.",
      "Make it feel more artisanal through texture and material cues."
    ],
    mixed_or_ambiguous: [
      "Lead with the more commercial direction first.",
      "Lead with the more artistic direction first.",
      "Blend both into a deliberate contrast-based concept."
    ]
  };

  return pickMany(optionsByFamily[family], 3, seed);
}

function buildLayoutIdea(family: CreativeIntentFamily, subject: string): string {
  switch (family) {
    case "poster_or_event_design":
      return `Use a dominant hero visual for ${subject}, a strong headline block near the top third, and a compact info strip that feels easy to scan.`;
    case "packaging_design":
      return `Front panel stays clean and iconic, side panels carry supporting story, and one premium accent detail creates the shelf memory.`;
    case "campaign_concept":
      return `Build one hero frame first, then break it into a repeatable system for launch key visual, social crops, and announcement assets.`;
    case "landing_page_visual_direction":
      return `Keep the first screen simple: headline left, proof or visual hook right, then a clean transition into supporting content blocks.`;
    case "brand_visual_direction":
      return `Start with a hero brand sheet: logotype zone, palette rhythm, typography pairings, and one signature graphic move that can scale.`;
    case "image_generation":
      return `Keep the subject large in frame, with one clear motion path and enough negative space to avoid a cluttered render.`;
    default:
      return `Center the strongest visual move first, then support it with a secondary information band and disciplined spacing.`;
  }
}

function buildCopyDirection(family: CreativeIntentFamily, request: NormalizedCreativeRequest): string | undefined {
  const subject = extractSubject(request.latestMessage ?? request.brief);
  switch (family) {
    case "poster_or_event_design":
      return `Keep the headline short and magnetic. Support with one clear invitation line and practical event details below.`;
    case "campaign_concept":
      return `Use a campaign line that sounds owned, short, and easy to repeat across launch assets.`;
    case "landing_page_visual_direction":
      return `Lead with one clear value statement, then support it with proof-driven subcopy rather than decorative copy.`;
    case "packaging_design":
      return `Front-of-pack copy should stay compact: product name, one appetite trigger, and one trust cue.`;
    case "brand_visual_direction":
      return `Brand voice should feel distilled and memorable. Think short promises, not long explanation.`;
    case "visual_design":
      return `Any copy should stay secondary to the visual move and avoid turning the piece into a report.`;
    case "image_generation":
      return `If any copy appears around ${subject}, keep it minimal so the image remains the hero.`;
    default:
      return undefined;
  }
}

function buildNeedFromYou(family: CreativeIntentFamily, request: NormalizedCreativeRequest): string | undefined {
  const text = getWorkingText(request, { type: "artifact_generation" } as Job).toLowerCase();

  if (family === "poster_or_event_design" && !hasAny(text, ["date", "time", "location"])) {
    return "Send the final event details when ready and I can tighten the poster copy.";
  }

  if (family === "landing_page_visual_direction" && !hasAny(text, ["product", "service", "app", "saas", "studio"])) {
    return "If you want a sharper hero, send the exact product or service name.";
  }

  if (family === "brand_visual_direction" && !hasAny(text, ["industry", "fashion", "food", "tech", "beauty"])) {
    return "If you want the identity tuned harder, send the category and audience.";
  }

  return undefined;
}

function refineSentence(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}

interface VisualAssetSpec {
  family: CreativeIntentFamily;
  title: string;
  subject: string;
  recommendedDirection: string;
  bigIdea: string;
  visualDirection: string;
  layoutIdea: string;
  copyDirection?: string;
  nextAction: string;
  prompt: string;
  styleOptions: string[];
  referenceImages?: AttachmentReferenceInput[];
  referenceInstructions?: string[];
}

interface VisualAssetResult {
  asset: ArtifactVisualAsset;
  prompt: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "design-artifact";
}

function toDataUri(reference: AttachmentReferenceInput): string {
  return `data:${reference.mimeType};base64,${reference.base64Data}`;
}

function wrapText(value: string, maxChars: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function getCanvas(family: CreativeIntentFamily): { width: number; height: number; size: "1024x1024" | "1024x1536" | "1536x1024" } {
  switch (family) {
    case "landing_page_visual_direction":
      return { width: 1536, height: 1024, size: "1536x1024" };
    case "brand_visual_direction":
      return { width: 1024, height: 1024, size: "1024x1024" };
    default:
      return { width: 1024, height: 1536, size: "1024x1536" };
  }
}

function pickPalette(seed: string): {
  backgroundA: string;
  backgroundB: string;
  accent: string;
  accentSoft: string;
  ink: string;
  paper: string;
} {
  const palettes = [
    {
      backgroundA: "#091524",
      backgroundB: "#16345a",
      accent: "#ff8c42",
      accentSoft: "#ffd3a8",
      ink: "#f7f0e8",
      paper: "#f4eadf"
    },
    {
      backgroundA: "#1b1127",
      backgroundB: "#4c1d58",
      accent: "#ff6f61",
      accentSoft: "#ffc8b8",
      ink: "#f7f0f2",
      paper: "#f7eff1"
    },
    {
      backgroundA: "#071f1c",
      backgroundB: "#0f4b40",
      accent: "#f4c95d",
      accentSoft: "#ffe8a6",
      ink: "#eef6ef",
      paper: "#edf2e8"
    },
    {
      backgroundA: "#1f0c14",
      backgroundB: "#5d1f38",
      accent: "#ffb703",
      accentSoft: "#ffe1a3",
      ink: "#fff4eb",
      paper: "#f7ecdf"
    }
  ] as const;

  return pickOne(palettes, seed);
}

function buildOpenAiVisualPrompt(spec: VisualAssetSpec): string {
  const title = spec.title;
  const common = [
    `Create one polished visual design artifact for "${title}".`,
    `Subject: ${spec.subject}.`,
    `Recommended direction: ${spec.recommendedDirection}`,
    `Big idea: ${spec.bigIdea}`,
    `Visual direction: ${spec.visualDirection}`,
    `Layout idea: ${spec.layoutIdea}`,
    spec.copyDirection ? `Copy direction: ${spec.copyDirection}` : undefined,
    spec.referenceInstructions?.length
      ? `Reference-image instructions: ${spec.referenceInstructions.join(" ")}`
      : undefined,
    `Keep the output looking like a real design draft, not a report or text slide.`,
    `High design quality, art-directed composition, premium lighting, strong hierarchy, no watermark.`
  ]
    .filter(Boolean)
    .join(" ");

  switch (spec.family) {
    case "image_generation":
      return `${common} Generate a full visual illustration or image concept with no layout labels.`;
    case "poster_or_event_design":
      return `${common} Render it as a poster concept in a vertical 4:5 composition with expressive typography.`;
    case "packaging_design":
      return `${common} Render it as a premium packaging concept shot with the packaging clearly visible as the hero.`;
    case "landing_page_visual_direction":
      return `${common} Render it as a landing-page hero visual direction in a wide composition, like a premium website concept frame.`;
    case "brand_visual_direction":
      return `${common} Render it as a brand direction board with strong graphic hierarchy, palette, type attitude, and signature forms.`;
    case "campaign_concept":
      return `${common} Render it as a campaign key visual with one iconic hero frame that can anchor a launch.`;
    default:
      return `${common} Render it as a polished visual concept board with one strong focal composition.`;
  }
}

function createLocalSvgAsset(spec: VisualAssetSpec): ArtifactVisualAsset {
  if ((spec.referenceImages?.length ?? 0) > 0) {
    const { width, height } = getCanvas(spec.family);
    const palette = pickPalette(`${spec.title}:${spec.subject}:reference`);
    const titleLines = wrapText(spec.title, 18).slice(0, 3);
    const subjectImage = spec.referenceImages?.[0];
    const styleImage = spec.referenceImages?.[1];
    const titleSvg = titleLines
      .map((line, index) => {
        const y = 140 + index * 70;
        return `<text x="90" y="${y}" fill="${palette.ink}" font-size="56" font-weight="800" font-family="Helvetica">${escapeXml(line)}</text>`;
      })
      .join("");
    const instruction = escapeXml(
      shorten(
        spec.referenceInstructions?.[0] ?? "Built from uploaded image references with a poster-first composition.",
        88
      )
    );
    const subjectLabel = escapeXml(subjectImage ? "Image 1 • Hero subject" : "Reference image");
    const styleLabel = escapeXml(styleImage ? "Image 2 • Layout / style" : "Supporting reference");

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${palette.backgroundA}" />
            <stop offset="100%" stop-color="${palette.backgroundB}" />
          </linearGradient>
          <linearGradient id="overlay" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#08101bcc" />
            <stop offset="100%" stop-color="#08101b33" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#bg)" />
        ${styleImage ? `<image href="${toDataUri(styleImage)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" opacity="0.42" />` : ""}
        <rect width="100%" height="100%" fill="url(#overlay)" />
        <rect x="72" y="72" width="${width - 144}" height="${height - 144}" rx="34" fill="#0e1726aa" stroke="${palette.paper}" stroke-opacity="0.14" />
        ${titleSvg}
        <text x="92" y="${height - 168}" fill="${palette.accentSoft}" font-size="24" font-family="Helvetica">${instruction}</text>
        ${
          subjectImage
            ? `<rect x="90" y="250" width="${Math.round(width * 0.38)}" height="${Math.round(height * 0.48)}" rx="24" fill="#ffffff22" />
               <image href="${toDataUri(subjectImage)}" x="90" y="250" width="${Math.round(width * 0.38)}" height="${Math.round(height * 0.48)}" preserveAspectRatio="xMidYMid slice" />
               <rect x="90" y="${250 + Math.round(height * 0.48) - 64}" width="${Math.round(width * 0.38)}" height="64" fill="#091524bb" />
               <text x="114" y="${250 + Math.round(height * 0.48) - 24}" fill="${palette.paper}" font-size="22" font-family="Helvetica">${subjectLabel}</text>`
            : ""
        }
        ${
          styleImage
            ? `<rect x="${Math.round(width * 0.56)}" y="286" width="${Math.round(width * 0.28)}" height="${Math.round(height * 0.28)}" rx="20" fill="#ffffff16" />
               <image href="${toDataUri(styleImage)}" x="${Math.round(width * 0.56)}" y="286" width="${Math.round(width * 0.28)}" height="${Math.round(height * 0.28)}" preserveAspectRatio="xMidYMid slice" opacity="0.92" />
               <rect x="${Math.round(width * 0.56)}" y="${286 + Math.round(height * 0.28) - 56}" width="${Math.round(width * 0.28)}" height="56" fill="#091524bb" />
               <text x="${Math.round(width * 0.56) + 20}" y="${286 + Math.round(height * 0.28) - 20}" fill="${palette.paper}" font-size="20" font-family="Helvetica">${styleLabel}</text>`
            : ""
        }
        <text x="${Math.round(width * 0.56)}" y="${Math.round(height * 0.70)}" fill="${palette.paper}" font-size="32" font-weight="700" font-family="Helvetica">${escapeXml(shorten(spec.recommendedDirection, 68))}</text>
        <text x="${Math.round(width * 0.56)}" y="${Math.round(height * 0.76)}" fill="${palette.accent}" font-size="20" font-family="Helvetica">${escapeXml(shorten(spec.bigIdea, 86))}</text>
        <text x="${Math.round(width * 0.56)}" y="${Math.round(height * 0.82)}" fill="${palette.paper}" font-size="18" font-family="Helvetica">${escapeXml(shorten(spec.layoutIdea, 96))}</text>
      </svg>
    `.replace(/\n\s+/g, "");

    return {
      kind: "document",
      mimeType: "image/svg+xml",
      fileName: `${slugify(spec.title)}.svg`,
      base64Data: Buffer.from(svg, "utf8").toString("base64"),
      width,
      height,
      source: "local_svg",
      prompt: spec.prompt
    };
  }

  const { width, height } = getCanvas(spec.family);
  const palette = pickPalette(`${spec.title}:${spec.subject}`);
  const titleLines = wrapText(spec.title, spec.family === "landing_page_visual_direction" ? 18 : 14).slice(0, 3);
  const directionLines = wrapText(spec.recommendedDirection, spec.family === "landing_page_visual_direction" ? 38 : 24).slice(0, 3);
  const ideaLines = wrapText(spec.bigIdea, spec.family === "landing_page_visual_direction" ? 44 : 28).slice(0, 3);
  const accentText = pickOne(spec.styleOptions, spec.prompt);
  const safeTitle = escapeXml(spec.title);
  const safeAccentText = escapeXml(accentText);
  const safePromptLabel = escapeXml(shorten(spec.prompt, 88));
  const topPad = spec.family === "landing_page_visual_direction" ? 118 : 146;
  const titleFontSize = spec.family === "landing_page_visual_direction" ? 118 : 96;
  const label = spec.family.replace(/_/g, " ").toUpperCase();

  const titleSvg = titleLines
    .map((line, index) => {
      const y = topPad + index * (titleFontSize + 16);
      return `<text x="90" y="${y}" fill="${palette.ink}" font-size="${titleFontSize}" font-weight="800" font-family="Helvetica">${escapeXml(line)}</text>`;
    })
    .join("");

  const directionSvg = directionLines
    .map((line, index) => `<text x="92" y="${height - 350 + index * 42}" fill="${palette.paper}" font-size="34" font-family="Helvetica">${escapeXml(line)}</text>`)
    .join("");

  const ideaSvg = ideaLines
    .map((line, index) => `<text x="92" y="${height - 228 + index * 32}" fill="${palette.accentSoft}" font-size="24" font-family="Helvetica">${escapeXml(line)}</text>`)
    .join("");

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${palette.backgroundA}" />
          <stop offset="100%" stop-color="${palette.backgroundB}" />
        </linearGradient>
        <radialGradient id="glow" cx="72%" cy="18%" r="42%">
          <stop offset="0%" stop-color="${palette.accent}" stop-opacity="0.95" />
          <stop offset="100%" stop-color="${palette.accent}" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)" />
      <circle cx="${Math.round(width * 0.78)}" cy="${Math.round(height * 0.22)}" r="${Math.round(Math.min(width, height) * 0.18)}" fill="url(#glow)" />
      <circle cx="${Math.round(width * 0.14)}" cy="${Math.round(height * 0.78)}" r="${Math.round(Math.min(width, height) * 0.12)}" fill="${palette.accent}" fill-opacity="0.14" />
      <path d="M${Math.round(width * 0.08)} ${Math.round(height * 0.62)} C ${Math.round(width * 0.28)} ${Math.round(height * 0.48)}, ${Math.round(width * 0.52)} ${Math.round(height * 0.78)}, ${Math.round(width * 0.92)} ${Math.round(height * 0.42)}" stroke="${palette.paper}" stroke-opacity="0.22" stroke-width="4" fill="none"/>
      <rect x="72" y="68" width="${spec.family === "landing_page_visual_direction" ? 318 : 244}" height="44" rx="22" fill="${palette.paper}" fill-opacity="0.12" />
      <text x="94" y="98" fill="${palette.paper}" font-size="22" font-weight="700" font-family="Helvetica">${escapeXml(label)}</text>
      ${titleSvg}
      <rect x="90" y="${height - 404}" width="${spec.family === "landing_page_visual_direction" ? 520 : 364}" height="38" rx="19" fill="${palette.paper}" fill-opacity="0.14" />
      <text x="112" y="${height - 378}" fill="${palette.paper}" font-size="20" font-family="Helvetica">${safeAccentText}</text>
      ${directionSvg}
      ${ideaSvg}
      <text x="${width - 420}" y="${height - 86}" fill="${palette.paper}" fill-opacity="0.72" font-size="18" font-family="Helvetica">${safePromptLabel}</text>
      <text x="${width - 186}" y="${height - 44}" fill="${palette.accentSoft}" font-size="18" font-weight="700" font-family="Helvetica">AI Design Team</text>
    </svg>
  `.replace(/\n\s+/g, "");

  return {
    kind: "document",
    mimeType: "image/svg+xml",
    fileName: `${slugify(spec.title)}.svg`,
    base64Data: Buffer.from(svg, "utf8").toString("base64"),
    width,
    height,
    source: "local_svg",
    prompt: spec.prompt
  };
}

function getBindingPreferredProvider(binding?: TelegramBinding): TelegramGenerationProvider {
  const candidate = binding?.metadata?.preferredProvider;
  return candidate === "gpt" ? "gpt" : "gemini";
}

function getRequestedProvider(snapshot: ProjectSnapshot, job: Job): TelegramGenerationProvider {
  const fromJobInput = job.input?.provider;
  if (fromJobInput === "gemini" || fromJobInput === "gpt") {
    return fromJobInput;
  }

  const fromJobMetadata = job.metadata?.provider;
  if (fromJobMetadata === "gemini" || fromJobMetadata === "gpt") {
    return fromJobMetadata;
  }

  return getBindingPreferredProvider(snapshot.telegramBinding);
}

function getGeminiAspectRatio(size: "1024x1024" | "1024x1536" | "1536x1024"): "1:1" | "2:3" | "3:2" {
  if (size === "1024x1024") {
    return "1:1";
  }

  return size === "1536x1024" ? "3:2" : "2:3";
}

async function buildVisualAsset(
  spec: VisualAssetSpec,
  selectedProvider: TelegramGenerationProvider,
  adapters: {
    openAi?: OpenAiAdapter;
    gemini?: GeminiAdapter;
  }
): Promise<VisualAssetResult> {
  const prompt = buildOpenAiVisualPrompt(spec);
  const { size } = getCanvas(spec.family);
  const tryOpenAi = async (): Promise<VisualAssetResult | null> => {
    if (adapters.openAi?.status !== "live") {
      return null;
    }

    try {
      const generated = await adapters.openAi.generateImage({
        prompt,
        size,
        quality: "medium",
        background: "opaque",
        referenceImages: spec.referenceImages
      });

      if (!generated) {
        return null;
      }

      return {
        asset: {
          ...generated.asset,
          fileName: `${slugify(spec.title)}.png`,
          prompt: generated.revisedPrompt ?? prompt
        },
        prompt: generated.revisedPrompt ?? prompt
      };
    } catch {
      return null;
    }
  };

  const tryGemini = async (): Promise<VisualAssetResult | null> => {
    if (adapters.gemini?.status !== "live") {
      return null;
    }

    try {
      const generated = await adapters.gemini.generateImage({
        prompt,
        aspectRatio: getGeminiAspectRatio(size),
        referenceImages: spec.referenceImages
      });

      if (!generated) {
        return null;
      }

      return {
        asset: {
          ...generated.asset,
          fileName: `${slugify(spec.title)}.png`,
          prompt
        },
        prompt
      };
    } catch {
      return null;
    }
  };

  const generated =
    selectedProvider === "gemini"
      ? (await tryGemini()) ?? (await tryOpenAi())
      : await tryOpenAi();

  if (generated) {
    return generated;
  }

  return {
    asset: createLocalSvgAsset({
      ...spec,
      prompt
    }),
    prompt
  };
}

function serializeVisualAsset(asset: ArtifactVisualAsset): JsonObject {
  return {
    kind: asset.kind,
    mimeType: asset.mimeType,
    fileName: asset.fileName,
    base64Data: asset.base64Data,
    width: asset.width ?? null,
    height: asset.height ?? null,
    source: asset.source,
    prompt: asset.prompt ?? null
  };
}

function renderDesignResult(body: {
  title: string;
  recommendedDirection: string;
  bigIdea: string;
  visualDirection: string;
  layoutIdea: string;
  copyDirection?: string;
  finalPrompt?: string;
  styleOptions: string[];
  alternatives: string[];
  assumptions: string[];
  needFromYou?: string;
  nextAction: string;
}): string {
  const sections = [
    body.title,
    "",
    "Recommended direction",
    body.recommendedDirection,
    "",
    "Big idea",
    body.bigIdea,
    "",
    "Visual direction",
    body.visualDirection,
    "",
    "Layout / composition",
    body.layoutIdea
  ];

  if (body.copyDirection) {
    sections.push("", "Copy direction", body.copyDirection);
  }

  if (body.finalPrompt) {
    sections.push("", "Final prompt", body.finalPrompt);
  }

  if (body.finalPrompt) {
    sections.push("", "Style options", ...body.styleOptions.map((option) => `- ${option}`));
  }

  if (body.finalPrompt) {
    sections.push("", "Next action", body.nextAction);
  } else {
    sections.push("", "Other routes", ...body.alternatives.map((option) => `- ${option}`));
    if (body.needFromYou) {
      sections.push("", "Need from you", body.needFromYou);
    }
    sections.push("", "Next action", body.nextAction);
  }

  sections.push("", "Assuming", ...body.assumptions.map((assumption) => `- ${assumption}`));
  return sections.join("\n");
}

function renderQuestionArtifact(body: {
  title: string;
  question: string;
  options: string[];
  needFromYou?: string;
}): string {
  const replyLine = body.needFromYou
    ? /^reply with/i.test(body.needFromYou)
      ? body.needFromYou
      : `Reply with: ${body.needFromYou}`
    : "";

  return [
    body.title,
    "",
    body.question,
    "",
    ...body.options.map((option) => `- ${option}`),
    replyLine
  ]
    .filter(Boolean)
    .join("\n");
}

function buildQuestionArtifact(request: NormalizedCreativeRequest, analysis: IntentAnalysis): ArtifactPipelineResult {
  const question = analysis.blockingQuestion ?? {
    title: "One quick clarification",
    question: analysis.blockingReason ?? "I need one short clarification before generating.",
    options: ["Reply with one short preference."],
    needFromYou: "one short answer"
  };

  const body: JsonObject = {
    artifactType: "question",
    question: question.question,
    options: question.options,
    needFromYou: question.needFromYou ?? null,
    intentFamily: analysis.family
  };

  return {
    kind: "question",
    title: question.title,
    summary: question.question,
    format: "markdown",
    body,
    renderedText: renderQuestionArtifact(question)
  };
}

function buildResultTitle(request: NormalizedCreativeRequest, family: CreativeIntentFamily, job: Job): string {
  const subject = titleCase(extractSubject(request.latestMessage ?? request.brief));
  const suffix =
    family === "image_generation"
      ? "Image Direction"
      : family === "poster_or_event_design"
        ? "Poster Direction"
        : family === "packaging_design"
          ? "Packaging Direction"
          : family === "campaign_concept"
            ? "Campaign Direction"
            : family === "landing_page_visual_direction"
              ? "Hero Direction"
              : family === "brand_visual_direction"
                ? "Brand Direction"
                : "Visual Direction";

  return job.type === "artifact_revision" ? `${subject} Refined ${suffix}` : `${subject} ${suffix}`;
}

function buildNextAction(family: CreativeIntentFamily, isRevision: boolean): string {
  if (family === "image_generation") {
    return isRevision
      ? "If you want, send one more style tweak and I will refine the prompt again."
      : "Use the prompt as-is for a first render, then send one tweak if you want a sharper second pass.";
  }

  return isRevision
    ? "If this is close, approve it. If not, send one focused revision note and I will tighten the direction."
    : "If this direction feels right, I can turn it into a sharper second pass with one focused revision note.";
}

async function buildImageArtifact(
  request: NormalizedCreativeRequest,
  analysis: IntentAnalysis,
  job: Job,
  selectedProvider: TelegramGenerationProvider,
  adapters: ArtifactGenerationPipelineInput,
  observer?: ArtifactGenerationObserver
): Promise<ArtifactPipelineResult> {
  const subject = extractSubject(request.latestMessage ?? request.brief);
  const mood = deriveMoodPhrases("image_generation", `${request.brief}:${request.revisionNote ?? ""}`);
  const assumptions = buildAssumptions(request, analysis.family);
  const styleOptions = buildStyleOptions("image_generation", subject);
  const finalPrompt = buildImagePrompt(subject, mood.visualDirection, request.revisionNote);
  const referenceInstructions = request.referencePlan?.instructions ?? [];
  const recommendedDirection = request.revisionNote
    ? refineSentence(`Keep the original scene energy, then push it toward ${request.revisionNote}.`)
    : mood.direction;
  const bigIdea =
    request.revisionNote && request.previousArtifact?.bigIdea
      ? refineSentence(`${request.previousArtifact.bigIdea} Then refine it with ${request.revisionNote}.`)
      : mood.bigIdea;
  const visualDirection = mood.visualDirection;
  const layoutIdea = buildLayoutIdea("image_generation", subject);
  const nextAction = buildNextAction(analysis.family, job.type === "artifact_revision");

  await emitStage(observer, {
    id: "compose",
    label: "Compose",
    status: "completed",
    detail: recommendedDirection
  });
  await emitPreview(observer, {
    title: buildResultTitle(request, analysis.family, job),
    recommendedDirection,
    bigIdea,
    nextStep: "Rendering the visual draft now."
  });
  await emitStage(observer, {
    id: "render",
    label: "Render",
    status: "running",
    detail: "Generating the visual artifact."
  });

  const visualAsset = await buildVisualAsset(
    {
      family: "image_generation",
      title: buildResultTitle(request, analysis.family, job),
      subject,
      recommendedDirection,
      bigIdea,
      visualDirection,
      layoutIdea,
      nextAction,
      prompt: finalPrompt,
      styleOptions,
      referenceImages: request.referenceImages,
      referenceInstructions
    },
    selectedProvider,
    adapters
  );

  await emitStage(observer, {
    id: "render",
    label: "Render",
    status: "completed",
    detail:
      visualAsset.asset.source === "local_svg"
        ? "Local fallback visual built and packaged."
        : `Visual artifact generated with ${visualAsset.asset.source}.`
  });

  const body = {
    artifactType: "design_result",
    intentFamily: analysis.family,
    title: buildResultTitle(request, analysis.family, job),
    recommendedDirection,
    bigIdea,
    visualDirection,
    layoutIdea,
    finalPrompt,
    styleOptions,
    assumptions,
    nextAction,
    referenceSummary: request.referencePlan?.summary ?? null,
    referenceImageCount: request.referenceImages.length,
    visualAsset: serializeVisualAsset(visualAsset.asset),
    visualAssetPrompt: visualAsset.prompt,
    requestedProvider: selectedProvider,
    visualProviderUsed: visualAsset.asset.source
  } satisfies JsonObject;

  return {
    kind: "design_result",
    title: String(body.title),
    summary: recommendedDirection,
    format: "visual+markdown",
    body,
    renderedText: renderDesignResult({
      title: String(body.title),
      recommendedDirection,
      bigIdea,
      visualDirection,
      layoutIdea,
      finalPrompt,
      styleOptions,
      alternatives: [],
      assumptions,
      nextAction: String(body.nextAction)
    })
  };
}

async function buildDesignArtifact(
  request: NormalizedCreativeRequest,
  analysis: IntentAnalysis,
  job: Job,
  selectedProvider: TelegramGenerationProvider,
  adapters: ArtifactGenerationPipelineInput,
  observer?: ArtifactGenerationObserver
): Promise<ArtifactPipelineResult> {
  const family = analysis.family === "mixed_or_ambiguous" ? "visual_design" : analysis.family;
  const subject = extractSubject(request.latestMessage ?? request.brief);
  const mood = deriveMoodPhrases(family, `${subject}:${request.revisionNote ?? ""}`);
  const assumptions = buildAssumptions(request, family);
  const alternatives = buildAlternatives(family, subject, request.brief);
  const styleOptions = buildStyleOptions(family, request.brief);
  const copyDirection = buildCopyDirection(family, request);
  const needFromYou = buildNeedFromYou(family, request);
  const referenceInstructions = request.referencePlan?.instructions ?? [];
  const previous = request.previousArtifact;

  const recommendedDirection =
    job.type === "artifact_revision" && request.revisionNote
      ? refineSentence(
          `Keep the core direction${previous?.recommendedDirection ? ` from "${previous.recommendedDirection}"` : ""}, then shift it toward ${request.revisionNote}.`
        )
      : mood.direction;

  const bigIdea =
    job.type === "artifact_revision" && request.revisionNote
      ? refineSentence(
          `${previous?.bigIdea ?? mood.bigIdea} Update the result so the change feels intentional, not pasted on.`
        )
      : mood.bigIdea;

  const visualDirection =
    job.type === "artifact_revision" && request.revisionNote && previous?.visualDirection
      ? refineSentence(`${previous.visualDirection} Then adapt it toward ${request.revisionNote}.`)
      : mood.visualDirection;

  const layoutIdea =
    job.type === "artifact_revision" && previous?.layoutIdea
      ? refineSentence(`${previous.layoutIdea} Keep that structure, but tune the emphasis for the new request.`)
      : buildLayoutIdea(family, subject);
  const nextAction = buildNextAction(family, job.type === "artifact_revision");

  await emitStage(observer, {
    id: "compose",
    label: "Compose",
    status: "completed",
    detail: recommendedDirection
  });
  await emitPreview(observer, {
    title: buildResultTitle(request, family, job),
    recommendedDirection,
    bigIdea,
    nextStep: "Rendering the visual draft now."
  });
  await emitStage(observer, {
    id: "render",
    label: "Render",
    status: "running",
    detail: "Turning the direction into a visual artifact."
  });

  const visualAsset = await buildVisualAsset(
    {
      family,
      title: buildResultTitle(request, family, job),
      subject,
      recommendedDirection,
      bigIdea,
      visualDirection,
      layoutIdea,
      copyDirection: copyDirection ?? undefined,
      nextAction,
      prompt: `${recommendedDirection} ${visualDirection} ${layoutIdea}`,
      styleOptions,
      referenceImages: request.referenceImages,
      referenceInstructions
    },
    selectedProvider,
    adapters
  );

  await emitStage(observer, {
    id: "render",
    label: "Render",
    status: "completed",
    detail:
      visualAsset.asset.source === "local_svg"
        ? "Local fallback visual built and packaged."
        : `Visual artifact generated with ${visualAsset.asset.source}.`
  });

  const body = {
    artifactType: "design_result",
    intentFamily: family,
    title: buildResultTitle(request, family, job),
    recommendedDirection,
    bigIdea,
    visualDirection,
    layoutIdea,
    copyDirection: copyDirection ?? null,
    alternatives,
    styleOptions,
    assumptions,
    needFromYou: needFromYou ?? null,
    nextAction,
    referenceSummary: request.referencePlan?.summary ?? null,
    referenceImageCount: request.referenceImages.length,
    visualAsset: serializeVisualAsset(visualAsset.asset),
    visualAssetPrompt: visualAsset.prompt,
    requestedProvider: selectedProvider,
    visualProviderUsed: visualAsset.asset.source
  } satisfies JsonObject;

  return {
    kind: "design_result",
    title: String(body.title),
    summary: recommendedDirection,
    format: "visual+markdown",
    body,
    renderedText: renderDesignResult({
      title: String(body.title),
      recommendedDirection,
      bigIdea,
      visualDirection,
      layoutIdea,
      copyDirection: copyDirection ?? undefined,
      alternatives,
      styleOptions,
      assumptions,
      needFromYou: needFromYou ?? undefined,
      nextAction: String(body.nextAction)
    })
  };
}

class GeneratorFirstArtifactPipeline implements ArtifactGenerationPipeline {
  constructor(private readonly input: ArtifactGenerationPipelineInput = {}) {}

  async generate(
    snapshot: ProjectSnapshot,
    job: Job,
    observer?: ArtifactGenerationObserver
  ): Promise<ArtifactPipelineResult> {
    await emitStage(observer, {
      id: "intake",
      label: "Intake",
      status: "running",
      detail: "Reading the brief and collecting the latest project context."
    });
    const request = normalizeRequest(snapshot, job);
    await emitStage(observer, {
      id: "intake",
      label: "Intake",
      status: "completed",
      detail: `Brief ready: ${extractSubject(request.latestMessage ?? request.brief)}.`
    });

    await emitStage(observer, {
      id: "intent",
      label: "Intent",
      status: "running",
      detail: "Inferring the strongest creative path for this request."
    });
    const analysis = inferIntentFamily(request, job);
    await emitStage(observer, {
      id: "intent",
      label: "Intent",
      status: "completed",
      detail: `Primary path: ${analysis.family.replace(/_/g, " ")}${analysis.secondaryFamily ? `, secondary: ${analysis.secondaryFamily.replace(/_/g, " ")}` : ""}.`
    });

    await emitStage(observer, {
      id: "clarify",
      label: "Clarify",
      status: "running",
      detail: "Checking whether anything is truly blocking."
    });

    if (analysis.isBlocking) {
      await emitStage(observer, {
        id: "clarify",
        label: "Clarify",
        status: "completed",
        detail: analysis.blockingQuestion?.question ?? analysis.blockingReason ?? "Need one short clarification before continuing."
      });
      return buildQuestionArtifact(request, analysis);
    }

    await emitStage(observer, {
      id: "clarify",
      label: "Clarify",
      status: "completed",
      detail: "No blocking clarification needed. Continuing with assumptions."
    });

    await emitStage(observer, {
      id: "compose",
      label: "Compose",
      status: "running",
      detail: "Shaping the direction, hierarchy, and first-pass idea."
    });
    const selectedProvider = getRequestedProvider(snapshot, job);

    if (analysis.family === "image_generation") {
      return buildImageArtifact(request, analysis, job, selectedProvider, this.input, observer);
    }

    return buildDesignArtifact(request, analysis, job, selectedProvider, this.input, observer);
  }
}

export function createArtifactGenerationPipeline(input: ArtifactGenerationPipelineInput = {}): ArtifactGenerationPipeline {
  return new GeneratorFirstArtifactPipeline(input);
}

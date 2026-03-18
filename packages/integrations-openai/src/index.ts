import type { ArtifactVisualAsset } from "@ai-design-team/types";

export interface OpenAiImageGenerationInput {
  prompt: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  quality?: "low" | "medium" | "high";
  background?: "transparent" | "opaque" | "auto";
}

export interface OpenAiImageGenerationResult {
  asset: ArtifactVisualAsset;
  revisedPrompt?: string;
}

export interface OpenAiAdapter {
  provider: "openai";
  model: string;
  status: "live" | "placeholder";
  allowStub: boolean;
  generateImage(input: OpenAiImageGenerationInput): Promise<OpenAiImageGenerationResult | null>;
}

export interface CreateOpenAiAdapterInput {
  apiKey?: string;
  imageModel: string;
  allowStub: boolean;
}

interface OpenAiImageApiResponse {
  data?: Array<{
    b64_json?: string;
    revised_prompt?: string;
  }>;
}

const OPENAI_IMAGE_TIMEOUT_MS = 20_000;

class LiveOpenAiAdapter implements OpenAiAdapter {
  readonly provider = "openai" as const;
  readonly status = "live" as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    readonly allowStub: boolean
  ) {}

  async generateImage(input: OpenAiImageGenerationInput): Promise<OpenAiImageGenerationResult | null> {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      signal: AbortSignal.timeout(OPENAI_IMAGE_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        prompt: input.prompt,
        size: input.size ?? "1024x1536",
        quality: input.quality ?? "medium",
        background: input.background ?? "opaque"
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI image generation failed: ${response.status} ${body}`);
    }

    const result = (await response.json()) as OpenAiImageApiResponse;
    const image = result.data?.[0];
    if (!image?.b64_json) {
      return null;
    }

    return {
      asset: {
        kind: "photo",
        mimeType: "image/png",
        fileName: "design-artifact.png",
        base64Data: image.b64_json,
        source: "openai",
        prompt: input.prompt
      },
      revisedPrompt: image.revised_prompt
    };
  }
}

class PlaceholderOpenAiAdapter implements OpenAiAdapter {
  readonly provider = "openai" as const;
  readonly status = "placeholder" as const;

  constructor(
    readonly model: string,
    readonly allowStub: boolean
  ) {}

  async generateImage(): Promise<OpenAiImageGenerationResult | null> {
    return null;
  }
}

export function createOpenAiAdapter(input: CreateOpenAiAdapterInput): OpenAiAdapter {
  const apiKey = input.apiKey?.trim();
  if (!apiKey || apiKey === "sk-placeholder") {
    return new PlaceholderOpenAiAdapter(input.imageModel, input.allowStub);
  }

  return new LiveOpenAiAdapter(apiKey, input.imageModel, input.allowStub);
}

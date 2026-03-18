import assert from "node:assert/strict";
import test from "node:test";

import { createArtifactGenerationPipeline } from "../src/index.ts";

const baseSnapshot = {
  project: {
    id: "project_1",
    title: "Poster request",
    brief: "design poster for Ruben Malayan calligraphy lesson",
    status: "active",
    currentJobId: "job_1",
    latestArtifactId: undefined,
    finalArtifactId: undefined,
    debugEnabled: false,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  attachments: [],
  jobs: [],
  timeline: []
};

test("pipeline falls back to a local visual artifact when no live image is returned", async () => {
  const pipeline = createArtifactGenerationPipeline({
    openAi: {
      provider: "openai",
      model: "gpt-image-1.5",
      status: "placeholder",
      allowStub: true,
      async generateImage() {
        return null;
      }
    }
  });

  const result = await pipeline.generate(baseSnapshot as any, {
    id: "job_1",
    projectId: "project_1",
    type: "artifact_generation",
    status: "running",
    queue: "default",
    availableAt: new Date().toISOString(),
    attemptCount: 1,
    maxAttempts: 3,
    input: {
      messageText: "design poster for Ruben Malayan calligraphy lesson"
    },
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as any);

  assert.equal(result.kind, "design_result");
  assert.equal(result.format, "visual+markdown");
  assert.equal((result.body as any).visualAsset.source, "local_svg");
  assert.equal((result.body as any).visualAsset.kind, "document");
});

test("pipeline stores an OpenAI image as the primary visual artifact when available", async () => {
  const pipeline = createArtifactGenerationPipeline({
    openAi: {
      provider: "openai",
      model: "gpt-image-1.5",
      status: "live",
      allowStub: true,
      async generateImage() {
        return {
          asset: {
            kind: "photo",
            mimeType: "image/png",
            fileName: "artifact.png",
            base64Data: "ZmFrZQ==",
            source: "openai",
            prompt: "poster concept"
          }
        };
      }
    }
  });

  const result = await pipeline.generate(baseSnapshot as any, {
    id: "job_2",
    projectId: "project_1",
    type: "artifact_generation",
    status: "running",
    queue: "default",
    availableAt: new Date().toISOString(),
    attemptCount: 1,
    maxAttempts: 3,
    input: {
      messageText: "design poster for Ruben Malayan calligraphy lesson"
    },
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as any);

  assert.equal((result.body as any).visualAsset.source, "openai");
  assert.equal((result.body as any).visualAsset.kind, "photo");
});

test("pipeline uses Gemini by default for new jobs and stores the Gemini asset when available", async () => {
  const pipeline = createArtifactGenerationPipeline({
    gemini: {
      provider: "gemini",
      model: "gemini-2.5-flash-image",
      status: "live",
      async generateImage() {
        return {
          asset: {
            kind: "photo",
            mimeType: "image/png",
            fileName: "artifact.png",
            base64Data: "ZmFrZQ==",
            source: "gemini",
            prompt: "poster concept"
          }
        };
      }
    },
    openAi: {
      provider: "openai",
      model: "gpt-image-1.5",
      status: "live",
      allowStub: true,
      async generateImage() {
        assert.fail("OpenAI should not be used when Gemini succeeds first.");
      }
    }
  });

  const result = await pipeline.generate(baseSnapshot as any, {
    id: "job_2a",
    projectId: "project_1",
    type: "artifact_generation",
    status: "running",
    queue: "default",
    availableAt: new Date().toISOString(),
    attemptCount: 1,
    maxAttempts: 3,
    input: {
      messageText: "design poster for Ruben Malayan calligraphy lesson"
    },
    metadata: {
      provider: "gemini"
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as any);

  assert.equal((result.body as any).visualAsset.source, "gemini");
  assert.equal((result.body as any).requestedProvider, "gemini");
});

test("pipeline falls back to OpenAI when Gemini is selected but fails before producing output", async () => {
  let geminiCalls = 0;
  let openAiCalls = 0;

  const pipeline = createArtifactGenerationPipeline({
    gemini: {
      provider: "gemini",
      model: "gemini-2.5-flash-image",
      status: "live",
      async generateImage() {
        geminiCalls += 1;
        throw new Error("Gemini unavailable");
      }
    },
    openAi: {
      provider: "openai",
      model: "gpt-image-1.5",
      status: "live",
      allowStub: true,
      async generateImage() {
        openAiCalls += 1;
        return {
          asset: {
            kind: "photo",
            mimeType: "image/png",
            fileName: "artifact.png",
            base64Data: "ZmFrZQ==",
            source: "openai",
            prompt: "poster concept"
          }
        };
      }
    }
  });

  const result = await pipeline.generate(baseSnapshot as any, {
    id: "job_2b",
    projectId: "project_1",
    type: "artifact_generation",
    status: "running",
    queue: "default",
    availableAt: new Date().toISOString(),
    attemptCount: 1,
    maxAttempts: 3,
    input: {
      messageText: "design poster for Ruben Malayan calligraphy lesson"
    },
    metadata: {
      provider: "gemini"
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as any);

  assert.equal(geminiCalls, 1);
  assert.equal(openAiCalls, 1);
  assert.equal((result.body as any).visualAsset.source, "openai");
});

test("pipeline emits stage updates and an early preview before returning the final artifact", async () => {
  const pipeline = createArtifactGenerationPipeline({
    openAi: {
      provider: "openai",
      model: "gpt-image-1.5",
      status: "placeholder",
      allowStub: true,
      async generateImage() {
        return null;
      }
    }
  });

  const stages: Array<{ id: string; status: string }> = [];
  const previews: Array<{ title: string; recommendedDirection: string }> = [];

  await pipeline.generate(
    baseSnapshot as any,
    {
      id: "job_3",
      projectId: "project_1",
      type: "artifact_generation",
      status: "running",
      queue: "default",
      availableAt: new Date().toISOString(),
      attemptCount: 1,
      maxAttempts: 3,
      input: {
        messageText: "dragon in water"
      },
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as any,
    {
      onStageUpdate(update) {
        stages.push({ id: update.id, status: update.status });
      },
      onPreview(preview) {
        previews.push({
          title: preview.title,
          recommendedDirection: preview.recommendedDirection
        });
      }
    }
  );

  assert.deepEqual(
    stages.map((entry) => `${entry.id}:${entry.status}`),
    [
      "intake:running",
      "intake:completed",
      "intent:running",
      "intent:completed",
      "clarify:running",
      "clarify:completed",
      "compose:running",
      "compose:completed",
      "render:running",
      "render:completed"
    ]
  );
  assert.equal(previews.length, 1);
  assert.match(previews[0]!.title, /Direction/);
});

test("pipeline passes uploaded image references into generation for image remix requests", async () => {
  let geminiInput: any;

  const pipeline = createArtifactGenerationPipeline({
    gemini: {
      provider: "gemini",
      model: "gemini-2.5-flash-image",
      status: "live",
      async generateImage(input) {
        geminiInput = input;
        return {
          asset: {
            kind: "photo",
            mimeType: "image/png",
            fileName: "artifact.png",
            base64Data: "ZmFrZQ==",
            source: "gemini",
            prompt: input.prompt
          }
        };
      }
    }
  });

  const result = await pipeline.generate(baseSnapshot as any, {
    id: "job_4",
    projectId: "project_1",
    type: "artifact_generation",
    status: "running",
    queue: "default",
    availableAt: new Date().toISOString(),
    attemptCount: 1,
    maxAttempts: 3,
    input: {
      messageText: "Create poster from the 1st uploaded guy image using all other data from 2nd image.",
      attachmentReferences: [
        {
          attachmentId: "attachment_1",
          order: 1,
          kind: "image",
          mimeType: "image/jpeg",
          fileName: "person.jpg",
          base64Data: "ZmFrZTE="
        },
        {
          attachmentId: "attachment_2",
          order: 2,
          kind: "image",
          mimeType: "image/jpeg",
          fileName: "poster.jpg",
          base64Data: "ZmFrZTI="
        }
      ]
    },
    metadata: {
      provider: "gemini"
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as any);

  assert.equal(geminiInput.referenceImages.length, 2);
  assert.match(geminiInput.prompt, /Use image 1 as the main subject/i);
  assert.equal((result.body as any).referenceImageCount, 2);
  assert.equal((result.body as any).visualAsset.source, "gemini");
});

test("pipeline fallback visual uses uploaded image references when live generation is unavailable", async () => {
  const pipeline = createArtifactGenerationPipeline({
    openAi: {
      provider: "openai",
      model: "gpt-image-1.5",
      status: "placeholder",
      allowStub: true,
      async generateImage() {
        return null;
      }
    }
  });

  const result = await pipeline.generate(baseSnapshot as any, {
    id: "job_5",
    projectId: "project_1",
    type: "artifact_generation",
    status: "running",
    queue: "default",
    availableAt: new Date().toISOString(),
    attemptCount: 1,
    maxAttempts: 3,
    input: {
      messageText: "Create poster from the 1st uploaded guy image using all other data from 2nd image.",
      attachmentReferences: [
        {
          attachmentId: "attachment_1",
          order: 1,
          kind: "image",
          mimeType: "image/jpeg",
          fileName: "person.jpg",
          base64Data: "ZmFrZTE="
        },
        {
          attachmentId: "attachment_2",
          order: 2,
          kind: "image",
          mimeType: "image/jpeg",
          fileName: "poster.jpg",
          base64Data: "ZmFrZTI="
        }
      ]
    },
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as any);

  const svg = Buffer.from((result.body as any).visualAsset.base64Data, "base64").toString("utf8");
  assert.equal((result.body as any).visualAsset.source, "local_svg");
  assert.match(svg, /Image 1 • Hero subject/);
  assert.match(svg, /data:image\/jpeg;base64,ZmFrZTE=/);
  assert.match(svg, /data:image\/jpeg;base64,ZmFrZTI=/);
});

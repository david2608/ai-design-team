import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCompactProgressMessage,
  formatDebugWorkflowMessage
} from "../src/index.ts";

test("compact progress message surfaces an early preview", () => {
  const message = formatCompactProgressMessage({
    preview: {
      title: "Calligraphy Lesson Poster Direction",
      recommendedDirection: "A poster that feels immediate from a distance and rich up close.",
      bigIdea: "Sell the event through one striking mood before the details land.",
      nextStep: "Rendering the visual draft now."
    },
    progressValue: 0.64,
    progressState: "refining"
  });

  assert.match(message, /^[█░]{15}/);
  assert.match(message, /Calligraphy Lesson Poster Direction/);
  assert.match(message, /Rendering the visual draft now|Stabilizing the first draft/);
  assert.match(message, /…/);
});

test("debug workflow message renders node states and handoffs clearly", () => {
  const message = formatDebugWorkflowMessage({
    nodes: [
      {
        id: "intake",
        label: "Intake",
        status: "completed",
        detail: "Brief normalized.",
        handoffToLabel: "Intent"
      },
      {
        id: "intent",
        label: "Intent",
        status: "running",
        detail: "Inferring the strongest creative path.",
        handoffToLabel: "Clarify"
      }
    ],
    preview: {
      title: "Dragon In Water Image Direction",
      recommendedDirection: "Painterly wonder with premium detail and a slightly mythic tone."
    },
    progressValue: 0.5,
    progressState: "generating"
  });

  assert.match(message, /^[█░]{15} generating/);
  assert.match(message, /Intake \[completed\]/);
  assert.match(message, /Intent \[running\]/);
  assert.match(message, /handoff -> Intent/);
  assert.match(message, /Live draft/);
});

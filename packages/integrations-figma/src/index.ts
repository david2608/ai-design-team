export interface FigmaIntegrationStatus {
  enabled: false;
  message: string;
}

export function getFigmaIntegrationStatus(): FigmaIntegrationStatus {
  return {
    enabled: false,
    message: "Figma remains optional and unimplemented in Phase 1."
  };
}

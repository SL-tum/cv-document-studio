import type { GenerationBrief } from "@cv-document-studio/review-contracts";

export interface GenerationBriefDraft {
  targetRole: string;
  projectBackground: string;
  requiredSkills: string;
  emphasis: string;
  language: string;
  additionalInstructions: string;
}

export const emptyGenerationBrief: GenerationBriefDraft = {
  targetRole: "",
  projectBackground: "",
  requiredSkills: "",
  emphasis: "",
  language: "English",
  additionalInstructions: "",
};

export function generationBriefIsReady(value: GenerationBriefDraft): boolean {
  return Boolean(
    value.targetRole.trim() &&
    value.projectBackground.trim() &&
    value.language.trim(),
  );
}

export function toGenerationBrief(
  value: GenerationBriefDraft,
): GenerationBrief {
  const additionalInstructions = value.additionalInstructions.trim();
  return {
    targetRole: value.targetRole.trim(),
    projectBackground: value.projectBackground.trim(),
    requiredSkills: list(value.requiredSkills),
    emphasis: list(value.emphasis),
    language: value.language.trim(),
    ...(additionalInstructions ? { additionalInstructions } : {}),
  };
}

function list(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,;\n]/u)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

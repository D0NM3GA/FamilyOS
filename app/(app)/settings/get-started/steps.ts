/** Phase 45.4: the guided setup's steps, in order. */
export const STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "home", label: "Household basics" },
  { id: "look", label: "Make it yours" },
  { id: "people", label: "Who's in your family" },
  { id: "apps", label: "Pick your apps" },
  { id: "phone", label: "Phone and safety" },
  { id: "done", label: "All set" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];

export const stepOf = (raw: string | undefined): StepId => STEPS.find((s) => s.id === raw)?.id ?? "welcome";

export function nextStep(step: string): StepId {
  const i = STEPS.findIndex((s) => s.id === step);
  return STEPS[Math.min(STEPS.length - 1, Math.max(0, i + 1))].id;
}

export function previousStep(step: string): StepId {
  const i = STEPS.findIndex((s) => s.id === step);
  return STEPS[Math.max(0, i - 1)].id;
}

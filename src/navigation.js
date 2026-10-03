// Coach is intentionally unavailable until the feature is ready to restore.
export const VISIBLE_TABS = [
  { label: "Health", icon: "health" },
  { label: "Recovery", icon: "recovery" },
  { label: "Training", icon: "training" },
];

export function resolveTab(requestedTab, savedTab) {
  const candidate = requestedTab || savedTab;
  return VISIBLE_TABS.some(({ label }) => label === candidate) ? candidate : "Recovery";
}

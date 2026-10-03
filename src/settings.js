const STORAGE_KEY = "tong-fit:settings:v1";

export const defaultSettings = {
  version: 1,
  goals: {
    primary: "Physique",
    durationWeeks: 16,
    targetWeightKg: "",
    trainingFrequency: 4,
    focusExercises: "Bench Press, Squat",
  },
  training: {
    days: ["Mon", "Tue", "Thu", "Sat"],
    equipment: "Full gym",
    style: "Hypertrophy",
    restDays: ["Wed", "Sun"],
    targetRpe: 8,
    maxRpe: 9,
    targetSetsMin: 10,
    targetSetsMax: 20,
  },
  personal: {
    age: "",
    heightCm: "",
    limitations: "",
    previousInjuries: "",
    precautions: "",
  },
  analytics: {
    unit: "kg",
    baselineDays: 28,
    comparison: "Personal baseline",
    featuredMetrics: ["Estimated 1RM", "Hard sets", "Average RPE"],
  },
  physique: {
    description: "Athletic, balanced, with more upper-back and shoulder development",
  },
};

function mergeSettings(saved = {}) {
  return {
    ...defaultSettings,
    ...saved,
    goals: { ...defaultSettings.goals, ...saved.goals },
    training: { ...defaultSettings.training, ...saved.training },
    personal: { ...defaultSettings.personal, ...saved.personal },
    analytics: { ...defaultSettings.analytics, ...saved.analytics },
    physique: { ...defaultSettings.physique, ...saved.physique },
  };
}

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return mergeSettings(saved || {});
  } catch {
    return defaultSettings;
  }
}

export function persistSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, version: 1 }));
}

export function resetSettings() {
  const next = structuredClone(defaultSettings);
  persistSettings(next);
  return next;
}

export function settingSummaries(settings) {
  return {
    goals: `${settings.goals.primary} · ${settings.goals.trainingFrequency}×/week`,
    training: `${settings.training.style} · RPE ${settings.training.targetRpe}`,
    personal: settings.personal.age ? `${settings.personal.age} years · ${settings.personal.heightCm || "—"} cm` : "Profile and movement constraints",
    analytics: `${settings.analytics.unit} · ${settings.analytics.baselineDays}-day baseline`,
    physique: settings.physique.description || "Reference and progress photos",
  };
}

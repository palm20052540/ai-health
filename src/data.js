export const ranges = ["7D", "30D", "6M", "1Y"];

export const chartSeries = {
  Health: {
    title: "Health trends",
    labels: ["Aug 20", "21", "22", "23", "24", "25", "26"],
    series: [
      { name: "Steps (k)", color: "#146BFA", values: [7.4, 8.1, 8.6, 8.9, 9.8, 10.5, 9.7] },
      { name: "Resting HR", color: "#76AEFF", values: [5.8, 5.4, 5.6, 5.9, 5.5, 5.3, 5.8] },
    ],
  },
  Recovery: {
    title: "Recovery signals",
    labels: ["Aug 20", "21", "22", "23", "24", "25", "26"],
    series: [
      { name: "HRV (ms)", color: "#146BFA", values: [6.2, 6.6, 6.1, 5.7, 6.3, 6.8, 6.0] },
      { name: "Resting HR", color: "#76AEFF", values: [3.2, 2.8, 3.1, 3.3, 2.8, 2.6, 3.2] },
    ],
  },
};

export const healthMetrics = [
  { icon: "moon", label: "Sleep", meta: "Total sleep time", value: "7h 42m", delta: "+28m", tone: "blue" },
  { icon: "shoe", label: "Steps", meta: "Daily average", value: "8,420", delta: "+11%", tone: "blue" },
  { icon: "heart", label: "Resting heart rate", meta: "Morning average", value: "54 bpm", delta: "typical", tone: "red" },
  { icon: "scale", label: "Weight", meta: "Latest", value: "71.8 kg", delta: "−0.4 kg", tone: "blue" },
  { icon: "flame", label: "Active zone minutes", meta: "Per day", value: "32 min", delta: "+6 min", tone: "orange" },
];

export const recoveryDrivers = [
  { icon: "moon", title: "Sleep consistency", detail: "Longer and more consistent sleep is helping recovery." },
  { icon: "pulse", title: "HRV baseline", detail: "HRV is near baseline despite higher training load." },
  { icon: "dumbbell", title: "Recent training load", detail: "Load is elevated. Keep today's planned intensity." },
];

export const exerciseProgress = [
  { name: "Bench Press", metric: "Estimated 1RM", result: "+4.8%", detail: "e1RM", values: [3.0, 3.8, 3.6, 4.8, 5.4, 6.0, 7.1] },
  { name: "Lat Pulldown", metric: "Reps at 60 kg", result: "+2 reps", detail: "at 60 kg", values: [3.1, 4.0, 4.5, 5.8, 5.2, 6.6, 7.2] },
  { name: "Squat", metric: "Working set", result: "Holding", detail: "RPE 8.7", values: [5.2, 5.0, 3.9, 5.1, 5.2, 4.7, 4.8] },
];

export const muscleBalance = [
  ["Chest", 118],
  ["Back", 72],
  ["Quads", 105],
  ["Hamstrings", 88],
  ["Shoulders", 96],
  ["Arms", 82],
];

export const metricDetails = {
  "Estimated 1RM": {
    title: "Estimated 1RM",
    body: "An estimate of the maximum load you could lift once, calculated from completed weight and reps. It is a trend signal—not a test result.",
    method: "Epley estimate: weight × (1 + reps ÷ 30). High-rep sets are treated cautiously.",
  },
  "HRV": {
    title: "HRV baseline",
    body: "Heart-rate variability is most useful relative to your own recent baseline. A single reading should not drive a training decision.",
    method: "This view compares recent daily HRV with your rolling personal baseline and reports data coverage.",
  },
  "Hard sets": {
    title: "Hard sets",
    body: "Working sets close enough to failure to contribute meaningfully to hypertrophy. Warm-ups are excluded when set type is available.",
    method: "Uses completed sets, reps, and logged RPE. Muscle allocation follows Hevy's primary and secondary muscle groups.",
  },
};

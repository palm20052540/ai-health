import React, { useMemo } from "react";
import { Icon } from "./icons";

function coachModel(view, settings) {
  const recovery = view?.insights?.Recovery;
  const health = view?.insights?.Health;
  const training = view?.insights?.Training;
  const recommendation = view?.training?.recommendation;
  const coverage = view?.coverage || {};
  const targetRpe = settings?.training?.targetRpe ?? 8;
  const load = recommendation?.load == null ? null : `${recommendation.load} kg`;
  const shouldProgress = recommendation?.load != null && recommendation?.currentLoad != null && recommendation.load > recommendation.currentLoad;
  const prescription = recommendation
    ? `${recommendation.exercise}: ${load || "hold the current load"} × ${recommendation.reps}, target RPE ${recommendation.targetRpe ?? targetRpe}.`
    : "Complete one more logged session to unlock a load prescription.";

  return {
    headline: recovery?.title || "Your adaptive coaching brief is building.",
    summary: recommendation
      ? `Recovery signals set the guardrails. Your highest-value training action is ${prescription}`
      : "Coach is combining recovery, activity, and training history before changing your plan.",
    action: {
      title: recommendation ? `${shouldProgress ? "Progress" : "Hold"} ${recommendation.exercise}` : "Build a reliable baseline",
      prescription,
      reason: recommendation?.explanation || "A recommendation needs repeated working sets with RPE coverage.",
      confidence: recommendation?.currentLoad == null ? "Low" : "Medium",
    },
    priorities: [
      {
        area: "Training",
        title: training?.title || "Training history is building.",
        detail: training?.copy || "Log working sets and RPE to improve prescriptions.",
        tone: "orange",
        icon: "training",
      },
      {
        area: "Recovery",
        title: recovery?.title || "Recovery baseline is building.",
        detail: recovery?.copy || "Sleep and HRV will set the next intensity guardrail.",
        tone: "blue",
        icon: "recovery",
      },
      {
        area: "Health",
        title: health?.title || "Health baseline is building.",
        detail: health?.copy || "Longitudinal activity data will shape the baseline.",
        tone: "blue",
        icon: "health",
      },
    ],
    evidence: [
      `${coverage.activity_complete_days || 0} activity days`,
      `${coverage.sleep_nights || 0} sleep nights`,
      `${view?.training?.recentWorkouts?.length || 0} recent workouts`,
    ],
  };
}

export function CoachView({ view, settings, generatedCoach, coachMode, onReviewPlan }) {
  const rulesCoach = useMemo(() => coachModel(view, settings), [view, settings]);
  const coach = generatedCoach || rulesCoach;

  return <div className="coach-view">
    <section className="coach-hero" aria-labelledby="coach-today-title">
      <div className="coach-orbit"><Icon name="coach" size={27} /></div>
      <div>
        <span className="coach-context">Adaptive brief · Today · {coachMode === "model" ? "AI generated" : "Evidence engine"}</span>
        <h2 id="coach-today-title">{coach.headline}</h2>
        <p>{coach.summary}</p>
      </div>
    </section>

    <section className="coach-action" aria-labelledby="next-action-title">
      <div className="section-title-row">
        <div><span className="section-kicker">Next best action</span><h2 id="next-action-title">{coach.action.title}</h2></div>
        <span className={`confidence confidence-${coach.action.confidence.toLowerCase()}`}>{coach.action.confidence} confidence</span>
      </div>
      <p className="coach-prescription">{coach.action.prescription}</p>
      <div className="coach-why"><Icon name="sparkle" size={18} /><span><strong>Why</strong>{coach.action.reason}</span></div>
      <button className="primary-button full" onClick={onReviewPlan}>Review next session</button>
    </section>

    <section className="coach-feed" aria-labelledby="priority-title">
      <div className="section-title-row"><div><span className="section-kicker">Cross-signal analysis</span><h2 id="priority-title">What deserves attention</h2></div></div>
      {coach.priorities.map((item, index) => <article className="coach-priority" key={item.area}>
        <span className={`priority-rank tone-${item.tone}`}>{index + 1}</span>
        <span className={`metric-icon ${item.tone}`}><Icon name={item.icon} size={21} /></span>
        <div><span className="priority-area">{item.area}</span><h3>{item.title}</h3><p>{item.detail}</p></div>
      </article>)}
    </section>

    <section className="coach-evidence" aria-labelledby="evidence-title">
      <div><Icon name="info" size={19} /><h2 id="evidence-title">How Coach decided</h2></div>
      <p>{coach.evidence.join(" · ")}</p>
      <small>Evidence-based wellness guidance, not medical diagnosis. Confidence rises as coverage improves.</small>
    </section>
  </div>;
}

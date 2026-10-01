export function coachConfidence({ dataCompleteness=1, sampleSize=1, modelAgreement=1, volatility=0, futureUncertainty=0 }) {
  const raw =
    dataCompleteness * 34 +
    sampleSize * 22 +
    modelAgreement * 28 +
    (1 - volatility) * 8 +
    (1 - futureUncertainty) * 8;
  return clamp(Math.round(raw), 35, 99);
}

export function confidenceBand(value) {
  if (value >= 90) return { label:"HIGH", tone:"good" };
  if (value >= 70) return { label:"MEDIUM", tone:"warn" };
  return { label:"LOW", tone:"danger" };
}

export function recommendation({ action, confidence, evidence=[], uncertainty=[], risk="Low", payload={} }) {
  return { action, confidence, evidence, uncertainty, risk, payload };
}

function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }

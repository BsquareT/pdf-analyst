const STOP = new Set([
  'the','is','a','an','and','or','but','in','of','to','for','with','by','from',
  'as','are','was','were','been','be','have','has','had','do','does','did','will',
  'would','could','should','may','might','this','that','these','those','it','its',
  'what','when','where','how','why','who','about','than','into','me','my','you',
  'your','we','our','they','their','i','am','not','can','if','then','so','up','on',
  'at','which','all','any','both','each','more','most','such','some','just','also'
]);

/**
 * Normalize a question for comparison:
 * lowercase → strip punctuation → remove stop words → sort → join
 */
export function normalizeQuestion(q) {
  if (!q || !q.trim()) return '__general__';
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w))
    .sort()
    .join(' ')
    .trim() || '__general__';
}

/**
 * Jaccard similarity between two normalized question strings.
 * Returns 0–1. Above 0.68 we consider them "the same question."
 */
export function jaccardSimilarity(a, b) {
  if (a === b) return 1;
  const setA = new Set(a.split(' ').filter(Boolean));
  const setB = new Set(b.split(' ').filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export const SIMILARITY_THRESHOLD = 0.68;

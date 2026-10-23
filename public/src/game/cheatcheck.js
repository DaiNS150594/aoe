// Recognise classic AoE cheat codes typed in chat.
const CODES = new Set([
  'pepperoni pizza', 'coinage', 'woodstock', 'quarry', 'steroids', 'reveal map', 'no fog', 'home run', 'resign',
  'diediedie', 'bigdaddy', 'big daddy', 'photon man', 'e=mc2 trooper', 'hoyohoyo', 'icbm', 'big bertha',
]);
export function applyCheatCheck(text) {
  const t = String(text).trim().toLowerCase().replace(/\s+/g, ' ');
  return CODES.has(t) || /^kill[1-8]$/.test(t);
}

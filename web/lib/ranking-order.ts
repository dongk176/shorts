export function rankingOrderForCount(order: number[], count: number) {
  const retained = [...new Set(order)].filter(
    (rank) => Number.isInteger(rank) && rank >= 1 && rank <= count,
  );
  return [
    ...retained,
    ...Array.from({ length: count }, (_, i) => i + 1).filter(
      (rank) => !retained.includes(rank),
    ),
  ];
}

export function moveRankingRank(order: number[], rank: number, target: number) {
  const from = order.indexOf(rank);
  const to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, rank);
  return next;
}

export function shuffleRankingOrder(order: number[], random = Math.random) {
  const next = [...order];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

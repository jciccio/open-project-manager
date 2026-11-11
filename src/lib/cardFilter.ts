export interface CardFilterOptions {
  searchQuery?: string;
  priorityFilter?: string;
  typeFilter?: string;
  hideSubtasks?: boolean;
  projectKey?: string | null;
}

export function matchesCardFilter(
  card: {
    title: string;
    description?: string | null;
    owner?: string | null;
    priority?: string | null;
    typeId?: string | null;
    parentId?: string | null;
    number?: number | null;
    identifier?: string | null;
    project?: { key?: string | null } | null;
  },
  options: CardFilterOptions
): boolean {
  const {
    searchQuery = "",
    priorityFilter = "ALL",
    typeFilter = "ALL",
    hideSubtasks = false,
    projectKey = null,
  } = options;

  if (hideSubtasks && card.parentId) {
    return false;
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    const titleMatch = card.title.toLowerCase().includes(q);
    const descMatch = card.description
      ? card.description.toLowerCase().includes(q)
      : false;
    const ownerMatch = card.owner
      ? card.owner.toLowerCase().includes(q)
      : false;

    // Match card identifier (e.g. KEY-NNN) or bare number (e.g. NNN or #NNN)
    const pKey = projectKey || card.project?.key;
    const cardIdStr = card.identifier || (pKey && card.number != null ? `${pKey}-${card.number}` : "");
    const lowerCardId = cardIdStr.toLowerCase();
    const idMatch = lowerCardId ? lowerCardId === q : false;

    const bareNumber = q.replace(/^#/, "");
    const numMatch = card.number != null && /^\d+$/.test(bareNumber) ? String(card.number) === bareNumber : false;

    if (!titleMatch && !descMatch && !ownerMatch && !idMatch && !numMatch) {
      return false;
    }
  }

  if (priorityFilter && priorityFilter !== "ALL") {
    const cardPriority = card.priority || "NONE";
    if (cardPriority !== priorityFilter) {
      return false;
    }
  }

  if (typeFilter && typeFilter !== "ALL") {
    if (typeFilter === "NONE") {
      if (card.typeId) return false;
    } else {
      if (card.typeId !== typeFilter) return false;
    }
  }

  return true;
}

export function filterCards<
  T extends {
    title: string;
    description?: string | null;
    owner?: string | null;
    priority?: string | null;
    typeId?: string | null;
    parentId?: string | null;
    number?: number | null;
    identifier?: string | null;
    project?: { key?: string | null } | null;
  }
>(cards: T[], options: CardFilterOptions): T[] {
  return cards.filter((card) => matchesCardFilter(card, options));
}

export function findCardByParam<
  T extends {
    id: string;
    number?: number | null;
    identifier?: string | null;
  }
>(cards: T[], param?: string | null, projectKey?: string | null): T | null {
  if (!param) return null;
  const p = param.trim();
  if (!p) return null;

  // 1. Exact ID match
  const byId = cards.find((c) => c.id === p);
  if (byId) return byId;

  // 2. Exact identifier match (case-insensitive)
  const pLower = p.toLowerCase();
  const byIdentifier = cards.find((c) => {
    const cardIdStr = c.identifier || (projectKey && c.number != null ? `${projectKey}-${c.number}` : "");
    return cardIdStr.toLowerCase() === pLower;
  });
  if (byIdentifier) return byIdentifier;

  // 3. Bare sequence number match (e.g. "42" or "#42")
  const bareNumber = p.replace(/^#/, "");
  const num = parseInt(bareNumber, 10);
  if (!isNaN(num) && String(num) === bareNumber) {
    const byNum = cards.find((c) => c.number === num);
    if (byNum) return byNum;
  }

  return null;
}

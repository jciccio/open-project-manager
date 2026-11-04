export interface CardFilterOptions {
  searchQuery?: string;
  priorityFilter?: string;
  typeFilter?: string;
  hideSubtasks?: boolean;
}

export function matchesCardFilter(
  card: {
    title: string;
    description?: string | null;
    owner?: string | null;
    priority?: string | null;
    typeId?: string | null;
    parentId?: string | null;
  },
  options: CardFilterOptions
): boolean {
  const {
    searchQuery = "",
    priorityFilter = "ALL",
    typeFilter = "ALL",
    hideSubtasks = false,
  } = options;

  if (hideSubtasks && card.parentId) {
    return false;
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    const titleMatch = card.title.toLowerCase().includes(q);
    const descMatch = card.description
      ? card.description.toLowerCase().includes(q)
      : false;
    const ownerMatch = card.owner
      ? card.owner.toLowerCase().includes(q)
      : false;
    if (!titleMatch && !descMatch && !ownerMatch) {
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
  }
>(cards: T[], options: CardFilterOptions): T[] {
  return cards.filter((card) => matchesCardFilter(card, options));
}

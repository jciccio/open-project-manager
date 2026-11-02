export const MCP_RESOURCES = [
  {
    uri: "opm://projects",
    name: "All Workspace Projects",
    mimeType: "application/json",
    description: "List of active projects in Open Project Manager",
  },
];

export const MCP_RESOURCE_TEMPLATES = [
  {
    uriTemplate: "opm://projects/{projectId}",
    name: "Project",
    mimeType: "application/json",
    description: "A project with its columns and cards",
  },
  {
    uriTemplate: "opm://cards/{cardId}",
    name: "Card",
    mimeType: "application/json",
    description: "A card with its column and comments",
  },
];

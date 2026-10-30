// Keep the revision locator in stored notes and agent prompts, while showing
// only the place in the document to the reader.
export const noteLocation = (where: string) => where.replace(/^Round\s+\d+(?:\s*·\s*|$)/i, '');

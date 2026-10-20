const CITATION_NUMBER_REGEX = /<citation-number\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/citation-number>/gi;
const CONTEXT_ASSET_REGEX = /(?:raw\/sources\/|\/)?context-assets\/([0-9a-f]{8}-[0-9a-f-]{27,})/gi;
const SOURCE_ASSET_ID_REGEX = /raw\/sources\/[^\s)"`]+\/assets\/([0-9a-f]{8}-[0-9a-f-]{27,})(?![\w.-])/gi;
const SOURCE_IMAGE_REGEX = /raw\/sources\/[\w./-]+\.(?:jpe?g|png|webp)/gi;
const WIKI_SOURCE_REGEX = /docs\/wiki_irri_farm\//i;

export function requireFinalAnswer(text: string, hasClarification: boolean): void {
	if (!text.trim() && !hasClarification) {
		throw new Error('Nao finished without a final answer.');
	}
}

/** Preserve valid SQL citations while removing tags invented without a matching query. */
export function stripUnsupportedCitations(text: string, validQueryIds: ReadonlySet<string>): string {
	return text.replace(CITATION_NUMBER_REGEX, (full, id: string, value: string) =>
		validQueryIds.has(id) ? full : value,
	);
}

/** Convert wiki asset URLs back to the source paths the documentation requires. */
export async function normalizeWikiAssetPaths(
	text: string,
	resolveAssetPath: (id: string) => Promise<string | undefined>,
	resolveCanonicalImagePath?: (claimedPath: string) => Promise<string | undefined>,
): Promise<string> {
	if (!WIKI_SOURCE_REGEX.test(text)) {
		return text;
	}

	const matches = [...text.matchAll(CONTEXT_ASSET_REGEX), ...text.matchAll(SOURCE_ASSET_ID_REGEX)];
	let normalized = text;
	for (const match of matches) {
		const id = match[1];
		const virtualPath = await resolveAssetPath(id);
		if (!virtualPath?.startsWith('/raw/sources/')) {
			throw new Error(`Wiki image ${id} has no canonical source path.`);
		}
		normalized = normalized.replaceAll(match[0], virtualPath.slice(1));
	}
	if (/raw\/sources\/[^\s)"`]*<[^>]+>/.test(normalized)) {
		throw new Error('Wiki answer contains an unresolved image path placeholder.');
	}
	if (resolveCanonicalImagePath) {
		for (const match of [...normalized.matchAll(SOURCE_IMAGE_REGEX)]) {
			const claimedPath = match[0];
			const canonicalPath = await resolveCanonicalImagePath(claimedPath);
			if (!canonicalPath) {
				throw new Error(`Wiki image has no canonical source path: ${claimedPath}`);
			}
			normalized = normalized.replaceAll(claimedPath, canonicalPath);
		}
	}
	return normalized;
}

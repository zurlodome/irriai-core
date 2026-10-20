import fs from 'fs/promises';
import path from 'path';

type ImageManifest = { images: { path: string }[] };

const sourceKey = (value: string): string => value.toLowerCase().replaceAll(/[^a-z0-9]/g, '');

export function matchCanonicalWikiImagePath(claimedPath: string, imagePaths: readonly string[]): string | undefined {
	const exact = imagePaths.find((path) => path === claimedPath);
	if (exact) {
		return exact;
	}

	const claimedParts = claimedPath.split('/');
	const claimedSource = sourceKey(claimedParts[2] ?? '');
	const claimedFile = claimedParts.at(-1)?.toLowerCase();
	const matches = imagePaths.filter((path) => {
		const parts = path.split('/');
		return sourceKey(parts[2] ?? '') === claimedSource && parts.at(-1)?.toLowerCase() === claimedFile;
	});
	return matches.length === 1 ? matches[0] : undefined;
}

export function createWikiImagePathResolver(projectId: string): (claimedPath: string) => Promise<string | undefined> {
	let paths: Promise<string[]> | undefined;
	return async (claimedPath) => {
		paths ??= (async () => {
			const { getProjectById } = await import('../../queries/project.queries');
			const project = await getProjectById(projectId);
			if (!project?.path) {
				throw new Error('Project path is unavailable while validating wiki images.');
			}
			const manifestPath = path.join(project.path, 'docs/wiki_irri_farm/manifests/images.json');
			const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as ImageManifest;
			return manifest.images.map((image) => image.path);
		})();
		return matchCanonicalWikiImagePath(claimedPath, await paths);
	};
}

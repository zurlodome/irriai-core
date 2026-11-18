import { createHash } from 'crypto';
import type { Stats } from 'fs';
import fs from 'fs/promises';
import path from 'path';

import { toRealPath, toVirtualPath } from '../utils/tools';

const MAX_CONTEXT_ASSET_BYTES = 5 * 1024 * 1024;
const CONTEXT_ASSET_URL_PREFIX = '/context-assets';

const INLINE_MARKDOWN_IMAGE_REGEX = /!\[([^\]\n]*(?:\][^\]\n]*)*)\]\(([^)\n]+)\)/g;
const LOCAL_IMAGE_REFERENCE_REGEX =
	/(^|[\s"'(<])((?:\.{0,2}\/|\/)?(?:[\w .-]+[\\/])*[\w .-]+\.(?:gif|jpe?g|png|svg|webp)(?:[?#][^\s"'<>)]*)?)/gim;

const IMAGE_MEDIA_TYPES: Record<string, string> = {
	'.gif': 'image/gif',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp',
};

export async function resolveMarkdownImageAssets(options: {
	content: string;
	projectId: string;
	projectFolder: string;
	sourceFilePath: string;
	readAssetBytes?: (virtualPath: string) => Promise<{ bytes: Buffer; virtualPath: string }>;
}): Promise<string> {
	return resolveTextImageAssets(options);
}

export async function resolveTextImageAssets(options: {
	content: string;
	projectId: string;
	projectFolder: string;
	sourceFilePath: string;
	readAssetBytes?: (virtualPath: string) => Promise<{ bytes: Buffer; virtualPath: string }>;
}): Promise<string> {
	const resolveUrl = async (rawDestination: string) => {
		const asset = await resolveLocalImageAsset({
			rawDestination,
			projectId: options.projectId,
			projectFolder: options.projectFolder,
			sourceFilePath: options.sourceFilePath,
			readAssetBytes: options.readAssetBytes,
		});
		return asset ? `${CONTEXT_ASSET_URL_PREFIX}/${asset.id}` : null;
	};

	const contentWithMarkdownImages = await rewriteMarkdownImageLinks(options.content, resolveUrl);
	return rewriteLocalImageReferences(contentWithMarkdownImages, resolveUrl);
}

export async function rewriteMarkdownImageLinks(
	content: string,
	resolveUrl: (rawDestination: string) => Promise<string | null>,
): Promise<string> {
	let result = '';
	let cursor = 0;

	for (const match of content.matchAll(INLINE_MARKDOWN_IMAGE_REGEX)) {
		const index = match.index;
		if (index === undefined) {
			continue;
		}

		const [fullMatch, altText, rawDestination] = match;
		result += content.slice(cursor, index);
		cursor = index + fullMatch.length;

		const parsed = parseMarkdownImageDestination(rawDestination);
		if (!parsed) {
			result += fullMatch;
			continue;
		}

		const replacementUrl = await resolveUrl(parsed.destination).catch(() => null);
		if (!replacementUrl) {
			result += fullMatch;
			continue;
		}

		result += `![${altText}](${replacementUrl}${parsed.titleSuffix})`;
	}

	return result + content.slice(cursor);
}

export async function rewriteLocalImageReferences(
	content: string,
	resolveUrl: (rawDestination: string) => Promise<string | null>,
): Promise<string> {
	let result = '';
	let cursor = 0;

	for (const match of content.matchAll(LOCAL_IMAGE_REFERENCE_REGEX)) {
		const index = match.index;
		if (index === undefined) {
			continue;
		}

		const [fullMatch, prefix, rawDestination] = match;
		const destinationStart = index + prefix.length;
		result += content.slice(cursor, destinationStart);
		cursor = index + fullMatch.length;

		const replacementUrl = await resolveUrl(rawDestination).catch(() => null);
		result += replacementUrl ?? rawDestination;
	}

	return result + content.slice(cursor);
}

async function resolveLocalImageAsset(options: {
	rawDestination: string;
	projectId: string;
	projectFolder: string;
	sourceFilePath: string;
	readAssetBytes?: (virtualPath: string) => Promise<{ bytes: Buffer; virtualPath: string }>;
}): Promise<{ id: string } | null> {
	const localPath = normalizeLocalMarkdownPath(options.rawDestination);
	if (!localPath) {
		return null;
	}

	const mediaType = getImageMediaType(localPath);
	if (!mediaType) {
		return null;
	}

	let buffer: Buffer;
	let assetVirtualPath: string;
	if (options.readAssetBytes) {
		const candidates = [
			...new Set([
				resolveAssetVirtualPath(localPath, options.sourceFilePath),
				path.posix.normalize(`/${localPath}`),
			]),
		];
		let asset: { bytes: Buffer; virtualPath: string } | undefined;
		for (const candidate of candidates) {
			try {
				asset = await options.readAssetBytes(candidate);
				break;
			} catch {
				/* Try the project-root spelling next. */
			}
		}
		if (!asset || asset.bytes.length > MAX_CONTEXT_ASSET_BYTES) {
			return null;
		}
		buffer = asset.bytes;
		assetVirtualPath = asset.virtualPath;
	} else {
		const resolvedAsset = await resolveAssetPath(localPath, options.sourceFilePath, options.projectFolder);
		if (!resolvedAsset || !resolvedAsset.stat.isFile() || resolvedAsset.stat.size > MAX_CONTEXT_ASSET_BYTES) {
			return null;
		}
		buffer = await fs.readFile(resolvedAsset.realPath);
		assetVirtualPath = toVirtualPath(resolvedAsset.realPath, options.projectFolder);
	}
	const contentHash = createHash('sha256').update(buffer).digest('hex');

	const { saveContextAsset } = await import('../queries/context-asset.queries');
	return saveContextAsset({
		projectId: options.projectId,
		virtualPath: assetVirtualPath,
		contentHash,
		data: buffer.toString('base64'),
		mediaType,
	});
}

async function resolveAssetPath(
	localPath: string,
	sourceFilePath: string,
	projectFolder: string,
): Promise<{ realPath: string; stat: Stats } | null> {
	const candidates = [
		resolveAssetVirtualPath(localPath, sourceFilePath),
		localPath.startsWith('/') ? path.posix.normalize(localPath) : path.posix.normalize(`/${localPath}`),
	];
	const uniqueCandidates = [...new Set(candidates)];

	for (const virtualPath of uniqueCandidates) {
		try {
			const realPath = toRealPath(virtualPath, projectFolder);
			const stat = await fs.stat(realPath);
			return { realPath, stat };
		} catch {
			continue;
		}
	}

	return null;
}

function parseMarkdownImageDestination(rawDestination: string): { destination: string; titleSuffix: string } | null {
	const trimmed = rawDestination.trim();
	if (!trimmed) {
		return null;
	}

	if (trimmed.startsWith('<')) {
		const end = trimmed.indexOf('>');
		if (end <= 1) {
			return null;
		}
		return {
			destination: trimmed.slice(1, end),
			titleSuffix: trimmed.slice(end + 1),
		};
	}

	const titleMatch = trimmed.match(/^(\S+)(\s+["'(].*)?$/);
	if (!titleMatch) {
		return { destination: trimmed, titleSuffix: '' };
	}

	return {
		destination: titleMatch[1],
		titleSuffix: titleMatch[2] ?? '',
	};
}

function normalizeLocalMarkdownPath(destination: string): string | null {
	if (destination.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(destination) || destination.startsWith('#')) {
		return null;
	}

	const withoutFragment = destination.split('#', 1)[0];
	const withoutQuery = withoutFragment.split('?', 1)[0];
	if (!withoutQuery) {
		return null;
	}

	try {
		return decodeURI(withoutQuery).replaceAll('\\', '/');
	} catch {
		return withoutQuery.replaceAll('\\', '/');
	}
}

function resolveAssetVirtualPath(localPath: string, sourceFilePath: string): string {
	if (localPath.startsWith('/')) {
		return path.posix.normalize(localPath);
	}

	const sourceVirtualPath = sourceFilePath.startsWith('/') ? sourceFilePath : `/${sourceFilePath}`;
	const sourceDir = path.posix.dirname(sourceVirtualPath.replaceAll('\\', '/'));
	return path.posix.normalize(path.posix.join(sourceDir, localPath));
}

function getImageMediaType(localPath: string): string | null {
	const extension = path.extname(localPath).toLowerCase();
	return IMAGE_MEDIA_TYPES[extension] ?? null;
}

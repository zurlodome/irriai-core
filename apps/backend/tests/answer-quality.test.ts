import { describe, expect, it } from 'vitest';

import {
	normalizeWikiAssetPaths,
	requireFinalAnswer,
	stripUnsupportedCitations,
} from '../src/mcp/tools/answer-quality';
import { matchCanonicalWikiImagePath } from '../src/mcp/tools/wiki-image-path';

describe('ask_nao answer quality', () => {
	it('rejects completed answers with no final text', () => {
		expect(() => requireFinalAnswer('  ', false)).toThrow('without a final answer');
		expect(() => requireFinalAnswer('', true)).not.toThrow();
	});

	it('strips only citation tags without a matching SQL query', () => {
		const text =
			'<citation-number id="query_dummy" column="x">24</citation-number> / ' +
			'<citation-number id="query_1" column="total">42</citation-number>';
		expect(stripUnsupportedCitations(text, new Set(['query_1']))).toBe(
			'24 / <citation-number id="query_1" column="total">42</citation-number>',
		);
	});

	it('maps wiki context asset URLs to their canonical source path', async () => {
		const id = 'ea26395f-8e1b-424d-939a-a06c4fe98be8';
		const text = `docs/wiki_irri_farm/products/RTU.md\n![RTU](raw/sources/context-assets/${id})`;
		const result = await normalizeWikiAssetPaths(
			text,
			async () => '/raw/sources/DF_Catalogo12_Giugno2026/assets/page_021_img_001.jpeg',
		);
		expect(result).toContain('![RTU](raw/sources/DF_Catalogo12_Giugno2026/assets/page_021_img_001.jpeg)');
		const invented = `docs/wiki_irri_farm/products/RTU.md raw/sources/df-catalogo12-giugno2026/assets/${id}`;
		expect(
			await normalizeWikiAssetPaths(
				invented,
				async () => '/raw/sources/DF_Catalogo12_Giugno2026/assets/page_021_img_001.jpeg',
			),
		).toContain('raw/sources/DF_Catalogo12_Giugno2026/assets/page_021_img_001.jpeg');
	});

	it('rejects unresolved wiki image references', async () => {
		const id = 'ea26395f-8e1b-424d-939a-a06c4fe98be8';
		await expect(
			normalizeWikiAssetPaths(`docs/wiki_irri_farm/concepts/RTU.md /context-assets/${id}`, async () => undefined),
		).rejects.toThrow('no canonical source path');
		await expect(
			normalizeWikiAssetPaths(
				'docs/wiki_irri_farm/concepts/RTU.md raw/sources/example/assets/<uuid>',
				async () => undefined,
			),
		).rejects.toThrow('placeholder');
	});

	it('repairs a source slug only when the manifest identifies one image', async () => {
		const canonical = 'raw/sources/DF_Catalogo12_Giugno2026/assets/page_028_img_001.jpeg';
		const claimed = 'raw/sources/df-catalogo12-giugno2026/assets/page_028_img_001.jpeg';
		expect(matchCanonicalWikiImagePath(claimed, [canonical])).toBe(canonical);
		const answer = `docs/wiki_irri_farm/concepts/IRRIFIELD.md ![Box](${claimed})`;
		expect(
			await normalizeWikiAssetPaths(
				answer,
				async () => undefined,
				async (path) => matchCanonicalWikiImagePath(path, [canonical]),
			),
		).toContain(canonical);
		expect(
			matchCanonicalWikiImagePath('raw/sources/unknown/assets/page_028_img_001.jpeg', [canonical]),
		).toBeUndefined();
	});
});

import { FileText, ImageIcon, Link2, Newspaper, Rows3 } from 'lucide-react';
import { Fragment, memo, useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Streamdown, StreamdownContext } from 'streamdown';
import { CONTEXT_FILE_TAG, normalizeCitationMarkers, STORY_REFERENCE_TAG, stripAssistantTags } from '@nao/shared';
import type { ReactNode } from 'react';

import { CitationPopover } from '@/components/citation-popover';
import { ImageLightbox } from '@/components/image-lightbox';
import { MarkdownTable } from '@/components/chat-messages/markdown-table';
import { StoryReferenceCard, StoryReferenceLink } from '@/components/chat-messages/story-reference-card';
import { StreamingMarkdown } from '@/components/chat-messages/streaming-markdown';
import { ContactSupportButton } from '@/components/contact-support-dialog';
import { ContextFileLink } from '@/components/context-file-link';
import { FileChip } from '@/components/file-chip';
import { ContextPdfViewer } from '@/components/side-panel/context-pdf-viewer';
import { Button } from '@/components/ui/button';
import { useSidePanel } from '@/contexts/side-panel';
import { isStoredFilePath } from '@/lib/attachments';
import { markdownPlugins } from '@/lib/markdown';
import { markdownLinkSafety } from '@/components/external-link-dialog';

type AssistantTextSegment =
	| { type: 'markdown'; text: string }
	| { type: 'story-reference'; storyId: string; title: string };

const CLOBBER_PREFIX = 'user-content-';

function MarkdownTableRenderer({ node, className }: any) {
	return <MarkdownTable node={node} className={className} />;
}
const CONTEXT_ASSET_URL_REGEX = /\/context-assets\/[0-9a-fA-F-]{8,}/g;
const MARKDOWN_CONTEXT_ASSET_IMAGE_REGEX =
	/!\[[^\]\n]*\]\(\s*<?(\/context-assets\/[0-9a-fA-F-]{8,})>?(?:\s+["'][^)\n]*["'])?\s*\)/g;
const LOCAL_PDF_PAGE_REFERENCE_REGEX = /^\/?([^#\n]+?\.pdf)#page=(\d+)$/i;
const MARKDOWN_LOCAL_IMAGE_REGEX =
	/!\[([^\]\n]*(?:\][^\]\n]*)*)\]\(\s*<?([^)\s>]+?\.(?:gif|jpe?g|png|svg|webp)(?:[?#][^)\s>]*)?)>?(?:\s+(["'][^)\n]*["']))?\s*\)/gim;
const LOCAL_IMAGE_REFERENCE_REGEX =
	/(^|[\s"'(<])((?:\.{0,2}\/|\/)?(?:[\w .-]+[\\/])*[\w .-]+\.(?:gif|jpe?g|png|svg|webp)(?:[?#][^\s"'<>)]*)?)/gim;
const SOURCES_HEADING_REGEX = /(^|\n)#{2,3}\s*(Fonti|Sources)\s*\n/i;
const PDF_REFERENCE_REGEX = /`?([^`\s,]+?\.pdf#page=\d+)`?/gi;
const IMAGE_FILE_EXTENSION_REGEX = /\.(?:gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const OMITTED_IMAGE_VALUE_REGEX =
	/^(?:-|n\/?a|none|null|no|not needed|not necessary|not required|non necessaria|non necessario|non richiesta|non richiesto|non disponibile|nessuna|nessuno)$/i;

function stripClobberPrefix(value: string): string {
	return value.startsWith(CLOBBER_PREFIX) ? value.slice(CLOBBER_PREFIX.length) : value;
}
const SETTLED_COMPONENTS = {
	table: MarkdownTableRenderer,
	'contact-support': ContactSupportRenderer,
	'citation-number': CitationNumberRenderer,
	'saved-file': SavedFileRenderer,
	[CONTEXT_FILE_TAG]: ContextFileRenderer,
	[STORY_REFERENCE_TAG]: StoryReferenceRenderer,
};
const STREAMING_COMPONENTS = {
	table: MarkdownTableRenderer,
	'contact-support': ContactSupportRenderer,
};
const ALLOWED_TAGS = {
	'contact-support': [],
	'citation-number': ['id', 'column'],
	'saved-file': ['path'],
	[CONTEXT_FILE_TAG]: ['path', 'lines'],
	[STORY_REFERENCE_TAG]: ['id'],
};
const LITERAL_TAG_CONTENT = ['contact-support', 'citation-number', 'saved-file', CONTEXT_FILE_TAG, STORY_REFERENCE_TAG];
const STORY_REFERENCE_LINE_PATTERN = new RegExp(
	`^\\s*<${STORY_REFERENCE_TAG}\\s+id\\s*=\\s*["']([^"'\\s]+)["']\\s*>([^<\\r\\n]*)</${STORY_REFERENCE_TAG}\\s*>\\s*$`,
);
const INLINE_CODE_PATTERN = /(?<![\\`])`([^`\r\n]+)`(?!`)/g;
const SUPPORT_LINK_PATTERN =
	/\[([^\]\r\n]+)\]\(\s*<?mailto:support@getnao\.io>?(?:\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^)\r\n]*\)))?\s*\)/gi;
const SAVED_FILE_ELEMENT_PATTERN =
	/^<saved-file\s+path\s*=\s*(?:"[^"\r\n]+"|'[^'\r\n]+')\s*>[^`\r\n]*?<\/saved-file\s*>$/;
const SAVED_FILE_TAG_START = '<saved-file';

export const AssistantTextWithCitation = memo(({ text, isStreaming }: { text: string; isStreaming: boolean }) => {
	const sidePanel = useSidePanel();
	const displayText = useMemo(() => rewriteLocalMarkdownImages(text, sidePanel.chatId), [text, sidePanel.chatId]);
	const contentSections = useMemo(
		() => (isStreaming ? { body: displayText, sources: null } : splitSourcesSection(displayText)),
		[displayText, isStreaming],
	);
	const imageUrls = useMemo(
		() => (isStreaming ? [] : extractStandaloneImageUrls(contentSections.body, sidePanel.chatId)),
		[contentSections.body, isStreaming, sidePanel.chatId],
	);
	const openPdf = useMemo(
		() => (pdf: PdfReference) => openPdfInSidePanel(pdf, sidePanel.chatId, sidePanel.open),
		[sidePanel.chatId, sidePanel.open],
	);
	const streamdownComponents = useMemo(
		() => ({
			...SETTLED_COMPONENTS,
			table: ({ node, className }: any) => <MarkdownTable node={node} className={className} />,
			inlineCode: ({ children, className }: any) => (
				<ContextPdfInlineReference
					value={String(children ?? '')}
					className={className}
					chatId={sidePanel.chatId}
					openPdf={openPdf}
				/>
			),
			a: ({ href, children, ...props }: any) => (
				<ContextPdfAnchor href={String(href ?? '')} chatId={sidePanel.chatId} openPdf={openPdf} {...props}>
					{children}
				</ContextPdfAnchor>
			),
			'citation-number': ({ id, column, children }: any) => {
				return (
					<span className='inline-block align-baseline mx-1'>
						<CitationPopover
							value={String(children)}
							queryId={stripClobberPrefix(String(id))}
							column={String(column)}
						/>
					</span>
				);
			},
			'saved-file': SavedFileRenderer,
		}),
		[sidePanel.chatId, openPdf],
	);

	if (isStreaming) {
		return (
			<StreamingMarkdown
				allowedTags={ALLOWED_TAGS}
				components={STREAMING_COMPONENTS}
				literalTagContent={LITERAL_TAG_CONTENT}
				text={displayText}
				transform={prepareStreamingMarkdown}
			/>
		);
	}

	const segments = splitStoryReferenceCards(
		replaceSupportLinks(
			unwrapBacktickedSavedFiles(normalizeCitationMarkers(placeMessageActionsLast(contentSections.body))),
		),
	);
	return (
		<>
			{segments.map((segment, index) =>
				segment.type === 'story-reference' ? (
					<StoryReferenceCard key={index} storyId={segment.storyId} title={segment.title} />
				) : (
					<SettledMarkdown key={index} markdown={segment.text} components={streamdownComponents} />
				),
			)}
			{contentSections.sources && (
				<SourcesSection sourceText={contentSections.sources} chatId={sidePanel.chatId} openPdf={openPdf} />
			)}
			<ContextAssetImages imageUrls={imageUrls} />
		</>
	);
});

function SettledMarkdown({ markdown, components }: { markdown: string; components: typeof SETTLED_COMPONENTS }) {
	return (
		<Streamdown
			linkSafety={markdownLinkSafety}
			className='assistant-markdown'
			dir='auto'
			plugins={markdownPlugins}
			allowedTags={ALLOWED_TAGS}
			literalTagContent={LITERAL_TAG_CONTENT}
			components={components}
		>
			{markdown}
		</Streamdown>
	);
}

function placeMessageActionsLast(markdown: string): string {
	return markdown
		.replace(
			'You’ve finished the Jaffle Shop preview. [Set up your own project](/onboarding) to keep chatting. This conversation is saved.',
			'You’ve used all the requests available for this example project. Let’s set up your own project and chat with your own data!',
		)
		.replace(
			'Your progress is safe, and the setup actions on this page still work. [Contact support](mailto:support@getnao.io) if you need help debugging your setup.',
			'Your progress is safe. If you need help completing setup.\n\n[Contact support](mailto:support@getnao.io)',
		);
}

function unwrapBacktickedSavedFiles(markdown: string): string {
	return transformMarkdownOutsideCodeBlocks(markdown, (line) =>
		line.replace(INLINE_CODE_PATTERN, (match, value: string) => (isSavedFileElement(value) ? value : match)),
	);
}

function replaceSupportLinks(markdown: string): string {
	return transformMarkdownOutsideCodeBlocks(markdown, (line) =>
		transformOutsideInlineCode(line, (text) =>
			text.replace(SUPPORT_LINK_PATTERN, '<contact-support>$1</contact-support>'),
		),
	);
}

function prepareStreamingMarkdown(markdown: string): string {
	return replaceSupportLinks(transformMarkdownOutsideCodeBlocks(markdown, suppressBacktickedSavedFiles));
}

function suppressBacktickedSavedFiles(line: string): string {
	let result = '';
	let offset = 0;

	while (offset < line.length) {
		const backtickOffset = line.indexOf('`', offset);
		if (backtickOffset === -1) {
			return result + stripAssistantTags(line.slice(offset));
		}

		if (!isSingleUnescapedBacktick(line, backtickOffset)) {
			result += stripAssistantTags(line.slice(offset, backtickOffset + 1));
			offset = backtickOffset + 1;
			continue;
		}

		result += stripAssistantTags(line.slice(offset, backtickOffset));
		const closingBacktickOffset = findClosingBacktick(line, backtickOffset + 1);
		if (closingBacktickOffset === -1) {
			return couldStartSavedFileTag(line.slice(backtickOffset + 1))
				? result
				: result + stripAssistantTags(line.slice(backtickOffset));
		}
		const value = line.slice(backtickOffset + 1, closingBacktickOffset);
		if (!isSavedFileElement(value)) {
			result += line.slice(backtickOffset, closingBacktickOffset + 1);
		}
		offset = closingBacktickOffset + 1;
	}

	return result;
}

function isSavedFileElement(value: string): boolean {
	return SAVED_FILE_ELEMENT_PATTERN.test(value);
}

function couldStartSavedFileTag(value: string): boolean {
	if (!value.startsWith('<')) {
		return false;
	}

	if (SAVED_FILE_TAG_START.startsWith(value)) {
		return true;
	}

	if (!value.startsWith(SAVED_FILE_TAG_START)) {
		return false;
	}

	const nextCharacter = value[SAVED_FILE_TAG_START.length];
	return nextCharacter === undefined || nextCharacter === '>' || /\s/.test(nextCharacter);
}

function findClosingBacktick(line: string, offset: number): number {
	for (let index = offset; index < line.length; index += 1) {
		if (line[index] === '`' && isSingleUnescapedBacktick(line, index)) {
			return index;
		}
	}

	return -1;
}

function isSingleUnescapedBacktick(line: string, offset: number): boolean {
	return line[offset - 1] !== '\\' && line[offset - 1] !== '`' && line[offset + 1] !== '`';
}

function transformOutsideInlineCode(line: string, transform: (text: string) => string): string {
	let result = '';
	let offset = 0;
	for (const match of line.matchAll(INLINE_CODE_PATTERN)) {
		const matchOffset = match.index;
		result += transform(line.slice(offset, matchOffset));
		result += match[0];
		offset = matchOffset + match[0].length;
	}
	return result + transform(line.slice(offset));
}

function transformMarkdownOutsideCodeBlocks(markdown: string, transformLine: (line: string) => string): string {
	return splitMarkdownLines(markdown)
		.map(({ text, isCode }) => (isCode ? text : transformLine(text)))
		.join('\n');
}

/** Story references written on a line of their own become cards between the markdown around them. */
function splitStoryReferenceCards(markdown: string): AssistantTextSegment[] {
	const segments: AssistantTextSegment[] = [];
	let markdownLines: string[] = [];
	const flushMarkdown = () => {
		if (markdownLines.length > 0) {
			segments.push({ type: 'markdown', text: markdownLines.join('\n') });
			markdownLines = [];
		}
	};

	for (const { text, isCode } of splitMarkdownLines(markdown)) {
		const match = isCode ? null : STORY_REFERENCE_LINE_PATTERN.exec(text);
		if (!match) {
			markdownLines.push(text);
			continue;
		}
		flushMarkdown();
		segments.push({ type: 'story-reference', storyId: match[1], title: match[2].trim() });
	}
	flushMarkdown();
	return segments;
}

function splitMarkdownLines(markdown: string): { text: string; isCode: boolean }[] {
	let fence: { marker: string; length: number } | undefined;

	return markdown.split('\n').map((text) => {
		const fenceMarker = getFenceMarker(text);
		if (fence) {
			if (fenceMarker?.marker === fence.marker && fenceMarker.length >= fence.length && fenceMarker.isClosing) {
				fence = undefined;
			}
			return { text, isCode: true };
		}

		if (fenceMarker) {
			fence = fenceMarker;
			return { text, isCode: true };
		}

		return { text, isCode: /^(?: {4}|\t)/.test(text) };
	});
}

function getFenceMarker(line: string): { marker: string; length: number; isClosing: boolean } | undefined {
	const match = /^(?:(?: {0,3}>[ \t]?)|(?: {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+))* {0,3}(`{3,}|~{3,})(.*)\r?$/.exec(line);
	if (!match) {
		return undefined;
	}

	const marker = match[1][0];
	return {
		marker,
		length: match[1].length,
		isClosing: match[2].trim().length === 0,
	};
}

/** A file the answer hands over. One nao cannot reach stays as the text the model wrote. */
function SavedFileRenderer({ path, children }: any) {
	const label = asText(children);
	const filePath = asText(path);
	if (!isStoredFilePath(filePath)) {
		return <>{label || filePath}</>;
	}

	return <FileChip path={filePath} label={label || undefined} className='mx-0.5' />;
}

function ContextFileRenderer({ path, lines, children }: any) {
	return <ContextFileLink path={asText(path)} lines={asText(lines)} label={asText(children)} />;
}

function StoryReferenceRenderer({ id, children }: any) {
	const storyId = stripClobberPrefix(asText(id));
	if (!storyId) {
		return <>{children}</>;
	}
	return <StoryReferenceLink storyId={storyId}>{children}</StoryReferenceLink>;
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function ContextPdfInlineReference({
	value,
	className,
	chatId,
	openPdf,
}: {
	value: string;
	className?: string;
	chatId: string | null;
	openPdf: (pdf: PdfReference) => void;
}) {
	const pdfReferences = parseLocalPdfReferences(value);
	if (!pdfReferences || !chatId) {
		return <code className={className}>{value}</code>;
	}

	return (
		<span className='inline-flex flex-wrap items-center gap-1 align-baseline'>
			{pdfReferences.map((pdf, index) => (
				<Fragment key={`${pdf.filePath}:${pdf.page ?? ''}:${index}`}>
					{index > 0 ? <span className='text-muted-foreground'>,</span> : null}
					<button
						type='button'
						className='rounded bg-muted px-1.5 py-0.5 font-mono text-sm underline decoration-dotted underline-offset-2 transition-colors hover:text-primary'
						onClick={() => openPdf(pdf)}
					>
						{formatPdfReference(pdf)}
					</button>
				</Fragment>
			))}
		</span>
	);
}

function ContextPdfAnchor({
	href,
	chatId,
	openPdf,
	children,
	...props
}: {
	href: string;
	chatId: string | null;
	openPdf: (pdf: PdfReference) => void;
	children: ReactNode;
}) {
	const pdf = parseLocalPdfReference(href);
	if (!pdf || !chatId) {
		return (
			<SafeMarkdownLink href={href} {...props}>
				{children}
			</SafeMarkdownLink>
		);
	}

	return (
		<button type='button' className='text-primary underline underline-offset-2' onClick={() => openPdf(pdf)}>
			{children}
		</button>
	);
}

function SafeMarkdownLink({
	href,
	children,
	node: _node,
	...props
}: {
	href: string;
	children: ReactNode;
	node?: unknown;
}) {
	const { linkSafety } = useContext(StreamdownContext);
	const [isOpen, setIsOpen] = useState(false);
	if (!linkSafety?.enabled) {
		return (
			<a href={href} {...props}>
				{children}
			</a>
		);
	}
	const url = new URL(href, window.location.href).href;
	const open = () => {
		window.open(url, '_blank', 'noreferrer');
	};
	const check = async () => {
		if (await linkSafety.onLinkCheck?.(url)) {
			open();
		} else {
			setIsOpen(true);
		}
	};
	return (
		<>
			<button type='button' className='text-primary underline underline-offset-2' onClick={check}>
				{children}
			</button>
			{linkSafety.renderModal?.({ isOpen, onClose: () => setIsOpen(false), onConfirm: open, url })}
		</>
	);
}

type PdfReference = { filePath: string; page?: number };

function openPdfInSidePanel(
	pdf: PdfReference,
	chatId: string | null,
	openSidePanel: (content: ReactNode, storySlug?: string) => void,
) {
	if (!chatId) {
		return;
	}

	openSidePanel(
		<ContextPdfViewer
			key={`${chatId}:${pdf.filePath}:${pdf.page ?? ''}`}
			chatId={chatId}
			filePath={pdf.filePath}
			page={pdf.page}
		/>,
	);
}

function parseLocalPdfReference(value: string): PdfReference | null {
	const trimmed = value.trim();
	if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) {
		return null;
	}

	const match = trimmed.match(LOCAL_PDF_PAGE_REFERENCE_REGEX);
	if (!match) {
		return null;
	}

	const page = match[2] ? Number.parseInt(match[2], 10) : undefined;
	return {
		filePath: match[1],
		page: page && page > 0 ? page : undefined,
	};
}

function parseLocalPdfReferences(value: string): PdfReference[] | null {
	const parts = value
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
	if (parts.length === 0) {
		return null;
	}

	const references = parts.map(parseLocalPdfReference);
	if (references.some((reference) => reference === null)) {
		return null;
	}
	return references as PdfReference[];
}

function formatPdfReference({ filePath, page }: PdfReference): string {
	return `${filePath}${page ? `#page=${page}` : ''}`;
}

function splitSourcesSection(text: string): { body: string; sources: string | null } {
	const match = SOURCES_HEADING_REGEX.exec(text);
	if (!match || match.index === undefined) {
		return { body: text, sources: null };
	}

	return {
		body: text.slice(0, match.index).trimEnd(),
		sources: text.slice(match.index + match[0].length).trim(),
	};
}

type SourceGroup = {
	wikiPages: string[];
	pdfs: string[];
	pages: string[];
	pdfRefs: PdfReference[];
	images: string[];
	details: Array<{ label: string; value: string }>;
};

function SourcesSection({
	sourceText,
	chatId,
	openPdf,
}: {
	sourceText: string;
	chatId: string | null;
	openPdf: (pdf: PdfReference) => void;
}) {
	const groups = useMemo(() => parseSourceGroups(sourceText), [sourceText]);

	if (groups.length === 0) {
		return null;
	}

	return (
		<section className='mt-5 max-w-full overflow-hidden rounded-lg border bg-muted/20 p-3 sm:p-4'>
			<div className='mb-3 flex items-center gap-2'>
				<div className='flex size-7 items-center justify-center rounded-md bg-background text-muted-foreground'>
					<Rows3 className='size-4' />
				</div>
				<div>
					<h2 className='text-base font-semibold leading-none'>Fonti</h2>
					<p className='mt-1 text-xs text-muted-foreground'>
						{groups.length === 1 ? '1 riferimento usato' : `${groups.length} riferimenti usati`}
					</p>
				</div>
			</div>
			<div className='grid min-w-0 gap-2'>
				{groups.map((group, index) => (
					<SourceCard
						key={`${group.wikiPages.join('|')}:${group.pdfRefs.map(formatPdfReference).join('|')}:${index}`}
						group={group}
						index={index}
						chatId={chatId}
						openPdf={openPdf}
					/>
				))}
			</div>
		</section>
	);
}

function SourceCard({
	group,
	index,
	chatId,
	openPdf,
}: {
	group: SourceGroup;
	index: number;
	chatId: string | null;
	openPdf: (pdf: PdfReference) => void;
}) {
	const title = group.wikiPages[0] ?? group.pdfs[0] ?? `Fonte ${index + 1}`;
	const subtitle = group.pdfs[0] ?? group.pages[0] ?? null;
	const imageUrls = useMemo(
		() =>
			chatId
				? group.images
						.map((image) => toRenderableSourceImageUrl(image, chatId))
						.filter((url): url is string => !!url)
				: [],
		[group.images, chatId],
	);

	return (
		<div className='min-w-0 overflow-hidden rounded-md border bg-background p-3'>
			<div className='flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
				<div className='min-w-0 space-y-1'>
					<div className='flex min-w-0 items-center gap-2'>
						<Newspaper className='size-4 shrink-0 text-muted-foreground' />
						<span className='truncate text-sm font-medium' title={title}>
							{title}
						</span>
					</div>
					{subtitle && (
						<div className='flex min-w-0 items-center gap-2 text-xs text-muted-foreground'>
							<FileText className='size-3.5 shrink-0' />
							<span className='truncate font-mono' title={subtitle}>
								{subtitle}
							</span>
						</div>
					)}
				</div>
				{group.pdfRefs.length > 0 && (
					<div className='flex min-w-0 max-w-full flex-wrap gap-1.5 sm:justify-end'>
						{group.pdfRefs.map((pdf) => (
							<Button
								key={formatPdfReference(pdf)}
								type='button'
								variant='outline'
								size='sm'
								className='h-7 gap-1.5 px-2 text-xs'
								disabled={!chatId}
								onClick={() => openPdf(pdf)}
							>
								<FileText className='size-3.5' />
								Pag. {pdf.page ?? '?'}
							</Button>
						))}
					</div>
				)}
			</div>
			{(group.pages.length > 0 || group.images.length > 0 || group.details.length > 0) && (
				<div className='mt-3 flex min-w-0 max-w-full flex-wrap gap-2 text-xs text-muted-foreground'>
					{group.pages.map((pages) => (
						<SourcePill
							key={`pages:${pages}`}
							icon={<Rows3 className='size-3' />}
							label={`Pagine ${pages}`}
						/>
					))}
					{group.images.map((image) => (
						<SourcePill
							key={`image:${image}`}
							icon={<ImageIcon className='size-3' />}
							label={image.split('/').pop() ?? image}
							title={image}
						/>
					))}
					{group.details.map((detail) => (
						<SourcePill
							key={`${detail.label}:${detail.value}`}
							icon={<Link2 className='size-3' />}
							label={`${detail.label}: ${detail.value}`}
						/>
					))}
				</div>
			)}
			<ContextAssetImages
				imageUrls={imageUrls}
				className='mt-3 flex flex-wrap gap-2'
				imageClassName='h-24 max-w-44 rounded-md border bg-muted/20 object-contain'
			/>
		</div>
	);
}

function SourcePill({ icon, label, title }: { icon: ReactNode; label: string; title?: string }) {
	return (
		<span
			className='inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden rounded bg-muted px-2 py-1 font-mono'
			title={title ?? label}
		>
			<span className='shrink-0'>{icon}</span>
			<span className='truncate'>{label}</span>
		</span>
	);
}

function parseSourceGroups(sourceText: string): SourceGroup[] {
	const groups: SourceGroup[] = [];
	let current = createSourceGroup();

	for (const rawLine of sourceText.split('\n')) {
		const line = cleanSourceLine(rawLine);
		if (!line) {
			continue;
		}

		const field = parseSourceField(line);
		if (!field) {
			addPdfRefs(current, line);
			continue;
		}

		if (field.label === 'wiki page' && hasSourceContent(current)) {
			groups.push(current);
			current = createSourceGroup();
		}

		switch (field.label) {
			case 'wiki page':
				current.wikiPages.push(field.value);
				break;
			case 'source pdf':
				current.pdfs.push(field.value);
				break;
			case 'source page':
			case 'source pages':
				current.pages.push(field.value);
				break;
			case 'pdf page url':
			case 'pdf page urls':
				addPdfRefs(current, field.value);
				break;
			case 'image':
			case 'image path':
				addSourceImages(current, field.value);
				break;
			default:
				current.details.push({ label: titleCase(field.label), value: field.value });
				break;
		}
	}

	if (hasSourceContent(current)) {
		groups.push(current);
	}

	return groups;
}

function createSourceGroup(): SourceGroup {
	return { wikiPages: [], pdfs: [], pages: [], pdfRefs: [], images: [], details: [] };
}

function hasSourceContent(group: SourceGroup): boolean {
	return (
		group.wikiPages.length > 0 ||
		group.pdfs.length > 0 ||
		group.pages.length > 0 ||
		group.pdfRefs.length > 0 ||
		group.images.length > 0 ||
		group.details.length > 0
	);
}

function cleanSourceLine(line: string): string {
	return line
		.trim()
		.replace(/^[-*]\s+/, '')
		.replace(/^`|`$/g, '')
		.trim();
}

function parseSourceField(line: string): { label: string; value: string } | null {
	const match = line.match(/^([^:]+):\s*(.+)$/);
	if (!match) {
		return null;
	}
	return { label: match[1].trim().toLowerCase(), value: stripMarkdownInline(match[2].trim()) };
}

function addPdfRefs(group: SourceGroup, value: string) {
	for (const match of value.matchAll(PDF_REFERENCE_REGEX)) {
		const pdf = parseLocalPdfReference(stripMarkdownInline(match[1]));
		if (!pdf) {
			continue;
		}
		if (!group.pdfRefs.some((existing) => formatPdfReference(existing) === formatPdfReference(pdf))) {
			group.pdfRefs.push(pdf);
		}
	}
}

function addSourceImages(group: SourceGroup, value: string) {
	for (const image of splitSourceValues(value)) {
		if (!isRenderableSourceImage(image)) {
			continue;
		}
		if (!group.images.includes(image)) {
			group.images.push(image);
		}
	}
}

function splitSourceValues(value: string): string[] {
	return value
		.split(',')
		.map((part) => stripMarkdownInline(part))
		.filter(Boolean);
}

function isRenderableSourceImage(value: string): boolean {
	const stripped = stripMarkdownInline(value);
	return (
		!!stripped &&
		!OMITTED_IMAGE_VALUE_REGEX.test(stripped) &&
		(stripped.startsWith('/context-assets/') || IMAGE_FILE_EXTENSION_REGEX.test(stripped))
	);
}

function stripMarkdownInline(value: string): string {
	return value.replaceAll('`', '').replace(/^"|"$/g, '').trim();
}

function titleCase(value: string): string {
	return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractStandaloneContextAssetUrls(text: string): string[] {
	const urls = new Set<string>();
	const markdownImageUrls = new Set([...text.matchAll(MARKDOWN_CONTEXT_ASSET_IMAGE_REGEX)].map((match) => match[1]));

	for (const match of text.matchAll(CONTEXT_ASSET_URL_REGEX)) {
		const url = match[0];
		if (markdownImageUrls.has(url)) {
			continue;
		}
		urls.add(url);
	}
	return [...urls];
}

function rewriteLocalMarkdownImages(text: string, chatId: string | null): string {
	if (!chatId) {
		return text;
	}

	return text.replace(
		MARKDOWN_LOCAL_IMAGE_REGEX,
		(fullMatch, altText: string, rawDestination: string, title = '') => {
			const imageUrl = toContextFileImageUrl(rawDestination, chatId);
			if (!imageUrl) {
				return fullMatch;
			}
			return `![${altText}](${imageUrl}${title ? ` ${title}` : ''})`;
		},
	);
}

function extractStandaloneImageUrls(text: string, chatId: string | null): string[] {
	const urls = new Set(extractStandaloneContextAssetUrls(text));
	if (!chatId) {
		return [...urls];
	}

	const markdownImageUrls = new Set(
		[...text.matchAll(MARKDOWN_LOCAL_IMAGE_REGEX)]
			.map((match) => toContextFileImageUrl(match[2], chatId))
			.filter((url): url is string => !!url),
	);

	for (const match of text.matchAll(LOCAL_IMAGE_REFERENCE_REGEX)) {
		const url = toContextFileImageUrl(match[2], chatId);
		if (url && !markdownImageUrls.has(url)) {
			urls.add(url);
		}
	}
	return [...urls];
}

function toContextFileImageUrl(rawPath: string, chatId: string): string | null {
	const trimmed = rawPath.trim();
	if (
		!trimmed ||
		trimmed.startsWith('/context-assets/') ||
		trimmed.startsWith('/context-files/') ||
		trimmed.startsWith('//') ||
		/^[a-z][a-z0-9+.-]*:/i.test(trimmed)
	) {
		return null;
	}

	return `/context-files/image?chatId=${encodeURIComponent(chatId)}&path=${encodeURIComponent(trimmed)}`;
}

function toRenderableSourceImageUrl(rawPath: string, chatId: string): string | null {
	const trimmed = rawPath.trim();
	if (!trimmed) {
		return null;
	}

	if (trimmed.startsWith('/context-assets/')) {
		return trimmed;
	}

	return toContextFileImageUrl(trimmed, chatId);
}

function ContextAssetImages({
	imageUrls,
	className = 'mt-3 flex flex-wrap gap-2',
	imageClassName = 'max-h-72 max-w-full rounded-md border object-contain',
}: {
	imageUrls: string[];
	className?: string;
	imageClassName?: string;
}) {
	const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

	if (imageUrls.length === 0) {
		return null;
	}

	return (
		<>
			<div className={className}>
				{imageUrls.map((url) => (
					<button key={url} type='button' className='cursor-pointer' onClick={() => setLightboxSrc(url)}>
						<img src={url} alt='' className={imageClassName} loading='lazy' />
					</button>
				))}
			</div>
			{lightboxSrc &&
				createPortal(<ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />, document.body)}
		</>
	);
}

function ContactSupportRenderer({ children }: any) {
	return <ContactSupportButton>{children}</ContactSupportButton>;
}

function CitationNumberRenderer({ id, column, children }: any) {
	return (
		<span className='inline-block align-baseline mx-1'>
			<CitationPopover
				value={String(children)}
				queryId={stripClobberPrefix(String(id))}
				column={String(column)}
			/>
		</span>
	);
}

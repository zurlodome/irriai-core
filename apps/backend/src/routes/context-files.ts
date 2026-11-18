import path from 'path';
import { z } from 'zod/v4';

import { readProjectFileBytes } from '../agents/tools/read';
import type { App } from '../app';
import { authMiddleware } from '../middleware/auth';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import { buildToolContext } from '../services/agent';
import { HandlerError } from '../utils/error';

const pdfQuerySchema = z.object({
	chatId: z.string().uuid(),
	path: z.string().min(1),
});

const imageQuerySchema = pdfQuerySchema;
const MAX_CONTEXT_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_MEDIA_TYPES: Record<string, string> = {
	'.gif': 'image/gif',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp',
};

export const contextFileRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.get('/pdf', { schema: { querystring: pdfQuerySchema } }, async (request, reply) => {
		const { chatId, path: virtualPath } = request.query;
		const chat = await chatQueries.getChatInfo(chatId);
		if (!chat) {
			throw new HandlerError('NOT_FOUND', 'Chat not found');
		}

		const userRole = await projectQueries.getUserRoleInProject(chat.projectId, request.user.id);
		if (!userRole) {
			throw new HandlerError('FORBIDDEN', 'You do not have access to this project');
		}

		const project = await projectQueries.retrieveProjectById(chat.projectId);
		if (!project.path) {
			throw new HandlerError('BAD_REQUEST', 'Project path not configured');
		}
		if (path.extname(virtualPath).toLowerCase() !== '.pdf') {
			throw new HandlerError('BAD_REQUEST', 'Only PDF files can be viewed');
		}

		const context = await buildToolContext({ projectId: chat.projectId, userId: request.user.id, chatId });
		const { realPath, bytes: buffer } = await readProjectFileBytes(virtualPath, context);
		return reply
			.header('Content-Type', 'application/pdf')
			.header('Content-Disposition', `inline; filename="${path.basename(realPath).replaceAll('"', '')}"`)
			.header('Cache-Control', 'private, no-store')
			.send(buffer);
	});

	app.get('/image', { schema: { querystring: imageQuerySchema } }, async (request, reply) => {
		const { chatId, path: rawVirtualPath } = request.query;
		const virtualPath = normalizeVirtualAssetPath(rawVirtualPath);
		const chat = await chatQueries.getChatInfo(chatId);
		if (!chat) {
			throw new HandlerError('NOT_FOUND', 'Chat not found');
		}

		const userRole = await projectQueries.getUserRoleInProject(chat.projectId, request.user.id);
		if (!userRole) {
			throw new HandlerError('FORBIDDEN', 'You do not have access to this project');
		}

		const project = await projectQueries.retrieveProjectById(chat.projectId);
		if (!project.path) {
			throw new HandlerError('BAD_REQUEST', 'Project path not configured');
		}

		const mediaType = IMAGE_MEDIA_TYPES[path.extname(virtualPath).toLowerCase()];
		if (!mediaType) {
			throw new HandlerError('BAD_REQUEST', 'Only image files can be viewed');
		}

		const context = await buildToolContext({ projectId: chat.projectId, userId: request.user.id, chatId });
		const { realPath, bytes: buffer } = await readProjectFileBytes(virtualPath, context);
		if (buffer.length > MAX_CONTEXT_IMAGE_BYTES) {
			throw new HandlerError('BAD_REQUEST', 'Image file is too large');
		}

		return reply
			.header('Content-Type', mediaType)
			.header('Content-Disposition', `inline; filename="${path.basename(realPath).replaceAll('"', '')}"`)
			.header('Cache-Control', 'private, no-store')
			.header('Content-Security-Policy', "default-src 'none'; sandbox")
			.send(buffer);
	});
};

function normalizeVirtualAssetPath(virtualPath: string): string {
	const withoutFragment = virtualPath.split('#', 1)[0];
	const withoutQuery = withoutFragment.split('?', 1)[0];
	try {
		return decodeURI(withoutQuery).replaceAll('\\', '/');
	} catch {
		return withoutQuery.replaceAll('\\', '/');
	}
}

import { z } from 'zod/v4';

import type { App } from '../app';
import { authMiddleware } from '../middleware/auth';
import { getContextAssetById } from '../queries/context-asset.queries';
import * as projectQueries from '../queries/project.queries';
import { buildMcpToolContext } from '../services/agent';
import { isProjectContextPathAllowed } from '../services/project-context-path-access.service';
import { HandlerError } from '../utils/error';

const paramsSchema = z.object({
	assetId: z.string().uuid(),
});

export const contextAssetRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);
	app.get('/:assetId', { schema: { params: paramsSchema } }, async (request, reply) => {
		const { assetId } = request.params;

		const asset = await getContextAssetById(assetId);
		if (!asset) {
			throw new HandlerError('NOT_FOUND', 'Context asset not found');
		}
		if (!(await projectQueries.getUserRoleInProject(asset.projectId, request.user.id))) {
			throw new HandlerError('FORBIDDEN', 'You do not have access to this project');
		}
		const context = await buildMcpToolContext({ projectId: asset.projectId, userId: request.user.id });
		if (!isProjectContextPathAllowed(context, asset.virtualPath, asset.virtualPath, 'file')) {
			throw new HandlerError('FORBIDDEN', 'You do not have access to this document');
		}

		if (!asset.mediaType.startsWith('image/')) {
			throw new HandlerError('BAD_REQUEST', 'Invalid media type');
		}

		const buffer = Buffer.from(asset.data, 'base64');
		return reply
			.header('Content-Type', asset.mediaType)
			.header('Cache-Control', 'private, no-store')
			.header('Content-Security-Policy', "default-src 'none'; sandbox")
			.send(buffer);
	});
};

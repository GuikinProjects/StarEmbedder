import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';
import { getPayload } from '$lib/server/renderStore.js';
import type { RenderPayload } from '$lib/types.js';

const PREVIEW_PAYLOAD: RenderPayload = {
	message: {
		id: '0',
		author: {
			id: '1',
			username: 'guikipt',
			displayName: 'GuikiPT',
			avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
			bot: false,
			roleColor: '#e67e22'
		},
		content: 'eaeaeaeae',
		attachments: [
			{
				url: 'https://raw.githubusercontent.com/skyra-project/discord-components-implementations/main/shared/public/dragonite.png',
				name: 'dragonite.png',
				contentType: 'image/png',
				width: 732,
				height: 670
			}
		],
		embeds: [],
		stickers: [
			{
				id: '1412179322814333028',
				name: 'duuude arsinev gonna be so mad',
				url: 'https://cdn.discordapp.com/stickers/1412179322814333028.png'
			}
		],
		reactions: [{ name: '💀', count: 3, isCustom: false }],
		reply: {
			authorName: 'SomeUser',
			avatarUrl: 'https://cdn.discordapp.com/embed/avatars/1.png',
			roleColor: '#3498db',
			content:
				'check this out <a:dancing:1234567890> and some **bold** ~~strike~~ text that goes on long enough to be truncated with an ellipsis eventually',
			attachment: false,
			edited: false
		},
		createdAt: new Date().toISOString()
	},
	guild: { name: 'Test Server' },
	channel: { name: 'general' },
	skullboard: { reactionCount: 3, reactionEmoji: '💀', messageUrl: 'https://discord.com' },
	resolved: { users: {}, roles: {}, channels: {} }
};

export const load: PageServerLoad = async ({ url }) => {
	if (url.searchParams.get('preview') === '1') {
		return { payload: PREVIEW_PAYLOAD };
	}

	const id = url.searchParams.get('id');
	if (!id) {
		return error(400, 'Missing id parameter');
	}

	const payload = getPayload(id);
	if (!payload) {
		return error(404, 'Render payload not found or expired');
	}

	return { payload };
};

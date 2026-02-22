export interface RenderAttachment {
	url: string;
	name: string;
	contentType: string;
	width?: number;
	height?: number;
	size?: number;
}

export interface RenderEmbedField {
	name: string;
	value: string;
	inline?: boolean;
}

export interface RenderEmbedAuthor {
	name: string;
	url?: string;
	iconURL?: string;
}

export interface RenderEmbedFooter {
	text: string;
	iconURL?: string;
}

export interface RenderEmbed {
	title?: string;
	description?: string;
	color?: number;
	url?: string;
	author?: RenderEmbedAuthor;
	thumbnail?: string;
	image?: string;
	video?: string;
	footer?: RenderEmbedFooter;
	timestamp?: string;
	fields?: RenderEmbedField[];
	provider?: string;
}

export interface RenderReaction {
	name: string;
	emojiUrl?: string;
	count: number;
	isCustom: boolean;
}

export interface RenderAuthor {
	id: string;
	username: string;
	displayName: string;
	avatarUrl: string;
	bot: boolean;
	roleColor?: string;
	roleIconUrl?: string;
	roleName?: string;
	clanIconUrl?: string;
	clanTag?: string;
}

export interface RenderReply {
	authorName: string;
	avatarUrl: string;
	roleColor?: string;
	content: string;
	attachment: boolean;
	edited: boolean;
}

export interface RenderSticker {
	id: string;
	name: string;
	url: string;
}

export interface RenderPayload {
	message: {
		id: string;
		author: RenderAuthor;
		content: string;
		attachments: RenderAttachment[];
		embeds: RenderEmbed[];
		reactions: RenderReaction[];
		reply?: RenderReply;
		stickers?: RenderSticker[];
		createdAt: string;
		editedAt?: string;
	};
	guild: {
		name: string;
	};
	channel: {
		name: string;
	};
	skullboard: {
		reactionCount: number;
		reactionEmoji: string;
		messageUrl: string;
	};
	resolved: {
		users: Record<string, string>;
		roles: Record<string, { name: string; color: string }>;
		channels: Record<string, string>;
	};
}

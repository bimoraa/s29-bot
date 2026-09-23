import { Collection } from "discord.js";

export function create_user(overrides = {}) {

  const user = {
    id: "100000000000000001",
    bot: false,
    username: "test-user",
    globalName: "Test User",
    displayName: "Test User",
    createdTimestamp: Date.parse("2020-01-01T00:00:00.000Z"),
    hexAccentColor: null,
    flags: { toArray: () => [] },
    displayAvatarURL: () => "https://cdn.example.test/avatar.png",
    bannerURL: () => null,
    avatarDecorationURL: () => null,
    fetch: async () => user,
    ...overrides,
  };

  return user;

}

export function create_member(user, overrides = {}) {

  return {
    id: user.id,
    user,
    displayName: user.displayName,
    nickname: null,
    joinedTimestamp: Date.parse("2021-01-01T00:00:00.000Z"),
    premiumSinceTimestamp: null,
    communicationDisabledUntilTimestamp: null,
    displayAvatarURL: user.displayAvatarURL,
    roles: { cache: new Collection() },
    ...overrides,
  };

}

export function create_guild(user, overrides = {}) {

  const member = create_member(user);
  const members = new Collection([[user.id, member]]);
  const guild = {
    id: "100000000000000099",
    name: "Test Server",
    ownerId: "100000000000000002",
    createdTimestamp: Date.parse("2021-01-01T00:00:00.000Z"),
    memberCount: 1,
    premiumSubscriptionCount: 0,
    premiumTier: 0,
    iconURL: () => null,
    channels: { cache: new Collection() },
    roles: { cache: new Collection() },
    members: {
      cache: members,
      fetch: async (user_id) => members.get(user_id),
    },
    ...overrides,
  };

  return { guild, member };

}

export function create_interaction(command_name, options = {}) {

  const user = options.user ?? create_user();
  const { guild, member } = create_guild(user, options.guild_overrides);
  const replies = [];
  const users_cache = new Collection([[user.id, user]]);
  const client = {
    ws: { ping: 41 },
    users: {
      cache: users_cache,
      fetch: async (user_id) => create_user({ id: user_id }),
    },
  };
  const strings = options.strings ?? {};
  const users = options.users ?? {};
  const members = options.members ?? {};

  return {
    commandName: command_name,
    guildId: options.guild_id ?? guild.id,
    guild,
    member,
    user,
    client,
    createdTimestamp: Date.now() - 12,
    replies,
    inCachedGuild: () => options.cached_guild !== false,
    options: {
      getString: (name) => strings[name] ?? null,
      getUser: (name) => users[name] ?? null,
      getMember: (name) => members[name] ?? null,
    },
    deferReply: async (defer_options) => {
      replies.push({ type: "defer", options: defer_options });
    },
    editReply: async (payload) => {
      replies.push({ type: "edit", payload });
      return payload;
    },
  };

}

export function get_component_text(payload) {

  const texts = [];

  function visit(value) {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    if (typeof value.content === "string") {
      texts.push(value.content);
    }

    for (const child of Object.values(value)) {
      visit(child);
    }
  }

  for (const component of payload.components ?? []) {
    visit(component.toJSON());
  }

  return texts.join("\n");

}

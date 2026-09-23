/* eslint @typescript-eslint/naming-convention: ["error", { "selector": "typeLike", "format": ["snake_case"] }, { "selector": "typeParameter", "format": ["snake_case"] }] */
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type {
  APIComponentInContainer,
  APIContainerComponent,
} from "discord-api-types/v10";

export interface template_options {
  fallback_title: string;
  fallback_body: string;
  avatar_url: string;
  avatar_description?: string;
  image_urls?: readonly string[];
  image_descriptions?: readonly string[];
}

const messages_directory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../messages");

export function create_components(
  title: string,
  body: string,
  avatar_url: string,
  image_urls: string[] = [],
  image_descriptions: string[] = [],
): [ContainerBuilder, ContainerBuilder] {

  const title_panel = new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(avatar_url)
            .setDescription(`Avatar ${title}`),
        ),
    );
  const body_panel = new ContainerBuilder()
    .addSeparatorComponents(new SeparatorBuilder({
      divider: true,
      spacing: 1,
    }))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

  if (image_urls.length > 0) {
    const media_gallery = new MediaGalleryBuilder();

    for (const [image_index, image_url] of image_urls.entries()) {
      media_gallery.addItems(
        new MediaGalleryItemBuilder()
          .setURL(image_url)
          .setDescription(image_descriptions[image_index] ?? title),
      );
    }

    body_panel.addMediaGalleryComponents(media_gallery);
  }

  return [title_panel, body_panel];

}

export async function create_template_components(
  template_name: string,
  values: Readonly<Record<string, string>>,
  options: template_options,
): Promise<Array<ContainerBuilder | APIContainerComponent>> {

  const template_components = await load_template_components(template_name, values, options);

  if (template_components === null) {
    return create_components(
      options.fallback_title,
      options.fallback_body,
      options.avatar_url,
      [...(options.image_urls ?? [])],
      [...(options.image_descriptions ?? [])],
    );
  }

  return template_components;

}

export async function send_template(
  interaction: ChatInputCommandInteraction,
  template_name: string,
  values: Readonly<Record<string, string>>,
  options: template_options,
): Promise<void> {

  await interaction.editReply({
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
    components: await create_template_components(template_name, values, options),
    attachments: [],
  });

}

export async function send_panel(
  interaction: ChatInputCommandInteraction,
  title: string,
  body: string,
  image_urls: string[] = [],
  avatar_url = interaction.user.displayAvatarURL({ size: 256 }),
  image_descriptions: string[] = [],
): Promise<void> {

  await interaction.editReply({
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
    components: create_components(title, body, avatar_url, image_urls, image_descriptions),
    attachments: [],
  });

}

export async function send_error_panel(
  interaction: ChatInputCommandInteraction,
  error_code: string,
): Promise<void> {

  await send_template(
    interaction,
    "util/error.message.json",
    { code: error_code },
    {
      fallback_title: `Error ${error_code}`,
      fallback_body: `Error code: ${error_code}\nLine: hidden`,
      avatar_url: interaction.user.displayAvatarURL({ size: 256 }),
    },
  );

}

interface template_render_context {
  values: Readonly<Record<string, string>>;
  options: template_options;
  attachment_index: number;
  button_index: number;
}

async function load_template_components(
  template_name: string,
  values: Readonly<Record<string, string>>,
  options: template_options,
): Promise<APIContainerComponent[] | null> {

  if (!template_name.endsWith(".json") || template_name.split("/").some((part) => !part || part === "." || part === "..")) {
    return null;
  }

  const template_path = resolve(messages_directory, template_name);
  const relative_path = relative(messages_directory, template_path);

  if (isAbsolute(relative_path) || relative_path.startsWith("..")) {
    return null;
  }

  let template_text: string;

  try {
    template_text = await readFile(template_path, "utf8");
  } catch (error) {
    if (is_missing_file(error)) {
      return null;
    }

    throw error;
  }

  try {
    const template_data: unknown = JSON.parse(template_text);
    return parse_template_containers(template_data, values, options);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }

    throw error;
  }

}

function parse_template_containers(
  template_data: unknown,
  values: Readonly<Record<string, string>>,
  options: template_options,
): APIContainerComponent[] | null {

  if (!is_record(template_data) || template_data.flags !== 32_768 || !Array.isArray(template_data.components)) {
    return null;
  }

  const context: template_render_context = {
    values,
    options,
    attachment_index: 0,
    button_index: 0,
  };
  const template_containers: APIContainerComponent[] = [];

  for (const component of template_data.components) {
    if (!is_record(component) || component.type !== 17 || !Array.isArray(component.components)) {
      continue;
    }

    const container_components: APIComponentInContainer[] = [];

    for (const child_component of component.components) {
      container_components.push(...parse_template_component(child_component, context));
    }

    template_containers.push({
      type: ComponentType.Container,
      components: container_components,
      ...(typeof component.accent_color === "number" || component.accent_color === null
        ? { accent_color: component.accent_color }
        : {}),
      ...(typeof component.spoiler === "boolean" ? { spoiler: component.spoiler } : {}),
    });
  }

  return template_containers.length > 0 ? template_containers : null;

}

function parse_template_component(
  component: unknown,
  context: template_render_context,
): APIComponentInContainer[] {

  if (!is_record(component) || typeof component.type !== "number") {
    return [];
  }

  if (component.type === 10 && typeof component.content === "string") {
    return create_template_text_components(component.content, context.values);
  }

  if (component.type === 14) {
    const separator = new SeparatorBuilder();

    if (typeof component.divider === "boolean") {
      separator.setDivider(component.divider);
    }

    if (component.spacing === SeparatorSpacingSize.Small || component.spacing === SeparatorSpacingSize.Large) {
      separator.setSpacing(component.spacing);
    }

    return [separator.toJSON()];
  }

  if (component.type === 9) {
    return parse_template_section(component, context);
  }

  if (component.type === 12 && Array.isArray(component.items)) {
    return parse_template_gallery(component.items, context);
  }

  if (component.type === 1 && Array.isArray(component.components)) {
    return parse_template_action_row(component.components, context);
  }

  return [];

}

function parse_template_section(
  component: Record<string, unknown>,
  context: template_render_context,
): APIComponentInContainer[] {

  if (!Array.isArray(component.components)) {
    return [];
  }

  const text_components = component.components.flatMap((child_component: unknown) => {
    if (!is_record(child_component) || child_component.type !== 10 || typeof child_component.content !== "string") {
      return [];
    }

    const content = replace_template_values(child_component.content, context.values);

    return content.trim()
      ? [new TextDisplayBuilder().setContent(content)]
      : [];
  }).slice(0, 3);

  if (text_components.length === 0) {
    return [];
  }

  const section = new SectionBuilder().addTextDisplayComponents(text_components);

  if (is_record(component.accessory) && component.accessory.type === 11) {
    const thumbnail = parse_template_thumbnail(component.accessory, context);

    if (thumbnail !== null) {
      section.setThumbnailAccessory(thumbnail);
    }
  } else if (is_record(component.accessory) && component.accessory.type === 2) {
    const button = parse_template_button(component.accessory, context);

    if (button !== null) {
      section.setButtonAccessory(button);
    }
  }

  return [section.toJSON()];

}

function parse_template_thumbnail(
  component: Record<string, unknown>,
  context: template_render_context,
): ThumbnailBuilder | null {

  if (!is_record(component.media) || typeof component.media.url !== "string") {
    return null;
  }

  const image_url = resolve_template_media_url(component.media.url, context, true);

  if (image_url === null) {
    return null;
  }

  const thumbnail = new ThumbnailBuilder().setURL(image_url);

  if (typeof component.description === "string") {
    thumbnail.setDescription(replace_template_values(component.description, context.values));
  }

  if (component.spoiler === true) {
    thumbnail.setSpoiler(true);
  }

  return thumbnail;

}

function parse_template_gallery(
  raw_items: unknown[],
  context: template_render_context,
): APIComponentInContainer[] {

  const gallery_items: MediaGalleryItemBuilder[] = [];
  let gallery_item_index = 0;

  for (const raw_item of raw_items.slice(0, 10)) {
    if (!is_record(raw_item) || !is_record(raw_item.media) || typeof raw_item.media.url !== "string") {
      continue;
    }

    const image_url = resolve_template_media_url(raw_item.media.url, context, false);

    if (image_url === null) {
      continue;
    }

    const gallery_item = new MediaGalleryItemBuilder().setURL(image_url);

    const description = typeof raw_item.description === "string"
      ? replace_template_values(raw_item.description, context.values)
      : context.options.image_descriptions?.[gallery_item_index];

    if (description) {
      gallery_item.setDescription(description);
    }

    if (raw_item.spoiler === true) {
      gallery_item.setSpoiler(true);
    }

    gallery_items.push(gallery_item);
    gallery_item_index += 1;
  }

  if (gallery_items.length === 0) {
    return [];
  }

  return [new MediaGalleryBuilder().addItems(gallery_items).toJSON()];

}

function parse_template_action_row(
  raw_buttons: unknown[],
  context: template_render_context,
): APIComponentInContainer[] {

  const buttons = raw_buttons.flatMap((raw_button) => {
    if (!is_record(raw_button) || raw_button.type !== 2) {
      return [];
    }

    const button = parse_template_button(raw_button, context);
    return button === null ? [] : [button];
  }).slice(0, 5);

  if (buttons.length === 0) {
    return [];
  }

  return [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons).toJSON()];

}

function parse_template_button(
  component: Record<string, unknown>,
  context: template_render_context,
): ButtonBuilder | null {

  if (typeof component.label !== "string") {
    return null;
  }

  const label = replace_button_label(component.label, context.values);

  if (!label.trim()) {
    return null;
  }

  const button = new ButtonBuilder().setLabel(Array.from(label).slice(0, 80).join(""));

  if (component.style === ButtonStyle.Link) {
    if (typeof component.url !== "string") {
      return null;
    }

    button.setStyle(ButtonStyle.Link).setURL(replace_template_values(component.url, context.values));

    if (component.disabled === true) {
      button.setDisabled(true);
    }

    return button;
  }

  const style = get_template_button_style(component.style);

  if (style === null) {
    return null;
  }

  button
    .setStyle(style)
    .setCustomId(`panel:template:disabled:${context.button_index}`)
    .setDisabled(true);
  context.button_index += 1;

  return button;

}

function get_template_button_style(style: unknown): ButtonStyle | null {

  switch (style) {
    case ButtonStyle.Primary:
      return ButtonStyle.Primary;
    case ButtonStyle.Secondary:
      return ButtonStyle.Secondary;
    case ButtonStyle.Success:
      return ButtonStyle.Success;
    case ButtonStyle.Danger:
      return ButtonStyle.Danger;
    default:
      return null;
  }

}

function resolve_template_media_url(
  template_url: string,
  context: template_render_context,
  use_avatar_fallback: boolean,
): string | null {

  let image_url = replace_template_values(template_url, context.values).trim();

  if (image_url.startsWith("attachment://")) {
    image_url = context.options.image_urls?.[context.attachment_index] ?? "";
    context.attachment_index += 1;

    if (!image_url && use_avatar_fallback) {
      image_url = context.options.avatar_url;
    }
  } else {
    const alias = image_url.replace(/^\{\{?/, "").replace(/\}\}?$/, "");

    if (["servericon", "userinfoavatar", "boticon"].includes(alias.toLowerCase())) {
      image_url = context.values[alias.toLowerCase()] ?? context.options.avatar_url;
    }
  }

  return image_url.startsWith("https://") || image_url.startsWith("http://")
    ? image_url
    : null;

}

function create_template_text_components(
  content: string,
  values: Readonly<Record<string, string>>,
): APIComponentInContainer[] {

  const static_lines: string[] = [];
  const rendered_components: APIComponentInContainer[] = [];

  const flush_static_lines = (): void => {
    const static_content = replace_template_values(static_lines.join("\n"), values);
    static_lines.length = 0;

    if (static_content.trim()) {
      rendered_components.push(new TextDisplayBuilder().setContent(static_content).toJSON());
    }
  };

  for (const line of content.split("\n")) {
    const rank_match = /\{\{((chat|voice)_user_([1-5]))_mention\}\}/.exec(line);
    const rank_number = rank_match ? Number(rank_match[3]) : 0;
    const user_count = rank_match ? Number(values[`${rank_match[2]}_user_count`] ?? 5) : 5;

    if (rank_match && rank_number > Math.max(user_count, 1)) {
      continue;
    }

    const avatar_url = rank_match ? values[`${rank_match[1]}_avatar_url`] : undefined;

    if (!rank_match || !avatar_url || (!avatar_url.startsWith("https://") && !avatar_url.startsWith("http://"))) {
      static_lines.push(line);
      continue;
    }

    flush_static_lines();
    rendered_components.push(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(replace_template_values(line, values)))
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(avatar_url)
            .setDescription(`Avatar member ${rank_match[1]}`),
        )
        .toJSON(),
    );
  }

  flush_static_lines();

  return rendered_components;

}

function replace_template_values(
  content: string,
  values: Readonly<Record<string, string>>,
): string {

  return content
    .replace(/\{\{([a-z_][a-z0-9_]*)\}\}/g, (match, key: string) => values[key] ?? match)
    .replace(/\{\{([a-z_][a-z0-9_]*)\}(?!\})/g, (match, key: string) => values[key] ?? match)
    .replace(/\{(?!\{)([a-z_][a-z0-9_]*)\}(?!\})/g, (match, key: string) => values[key] ?? match);

}

function replace_button_label(
  label: string,
  values: Readonly<Record<string, string>>,
): string {

  const requester_display_name = values.requester_display_name ?? "";
  const target_display_name = values.target_display_name ?? "";

  return replace_template_values(label, values)
    .replaceAll("{discord_username/display_nameifavailabe}", requester_display_name)
    .replaceAll("{target_username/display_nameifavailabe}", target_display_name)
    .replaceAll("{username}", requester_display_name)
    .replaceAll("xxx", target_display_name);

}

function is_missing_file(error: unknown): boolean {

  return is_record(error) && error.code === "ENOENT";

}

function is_record(value: unknown): value is Record<string, unknown> {

  return typeof value === "object" && value !== null && !Array.isArray(value);

}

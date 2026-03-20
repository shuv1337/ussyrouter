import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type Attachment,
  type ChatInputCommandInteraction,
} from "discord.js";
import { generateImage, generateVideo, parseLayout, transcribeAudio } from "../../media";
import { AbsoluteQuotaAdapter } from "../../quota";
import { ensureGuild, ensureUser, isUserApproved } from "../../db/users";
import { saveSharePayload } from "../media-share";

const quota = new AbsoluteQuotaAdapter();

function imageModels() {
  return [
    { name: "GLM-Image", value: "glm-image" },
    { name: "CogView-4", value: "cogview-4-250304" },
  ] as const;
}

function videoModels() {
  return [
    { name: "CogVideoX-3", value: "cogvideox-3" },
    { name: "ViduQ1 Text", value: "viduq1-text" },
    { name: "ViduQ1 Image", value: "viduq1-image" },
    { name: "ViduQ1 Start-End", value: "viduq1-start-end" },
    { name: "Vidu2 Image", value: "vidu2-image" },
    { name: "Vidu2 Start-End", value: "vidu2-start-end" },
    { name: "Vidu2 Reference", value: "vidu2-reference" },
  ] as const;
}

export const data = new SlashCommandBuilder()
  .setName("generate")
  .setDescription("Generate media with Z.AI through Routussy")
  .addSubcommand((sub) =>
    sub
      .setName("image")
      .setDescription("Generate an image")
      .addStringOption((opt) =>
        opt.setName("prompt").setDescription("Image prompt").setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("model")
          .setDescription("Image model")
          .setRequired(true)
          .addChoices(...imageModels())
      )
      .addStringOption((opt) =>
        opt.setName("size").setDescription("Optional size, e.g. 1280x1280")
      )
      .addStringOption((opt) =>
        opt
          .setName("quality")
          .setDescription("Optional image quality")
          .addChoices(
            { name: "HD", value: "hd" },
            { name: "Standard", value: "standard" }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("video")
      .setDescription("Generate a video")
      .addStringOption((opt) =>
        opt
          .setName("model")
          .setDescription("Video model")
          .setRequired(true)
          .addChoices(...videoModels())
      )
      .addStringOption((opt) =>
        opt.setName("prompt").setDescription("Prompt for the video")
      )
      .addAttachmentOption((opt) =>
        opt.setName("image").setDescription("Optional source image")
      )
      .addAttachmentOption((opt) =>
        opt.setName("image2").setDescription("Optional second source image")
      )
      .addAttachmentOption((opt) =>
        opt.setName("image3").setDescription("Optional third source image")
      )
      .addBooleanOption((opt) =>
        opt
          .setName("with_audio")
          .setDescription("Add audio if the model supports it")
      )
      .addStringOption((opt) =>
        opt
          .setName("aspect_ratio")
          .setDescription("Optional aspect ratio")
          .addChoices(
            { name: "16:9", value: "16:9" },
            { name: "9:16", value: "9:16" },
            { name: "1:1", value: "1:1" }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("ocr")
      .setDescription("Extract text from an image or PDF with GLM-OCR")
      .addAttachmentOption((opt) =>
        opt.setName("file").setDescription("Image or PDF to parse").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("transcribe")
      .setDescription("Transcribe a short WAV or MP3 audio clip")
      .addAttachmentOption((opt) =>
        opt
          .setName("file")
          .setDescription("Audio file to transcribe (.wav or .mp3, max 25MB)")
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName("prompt").setDescription("Optional context or expected words")
      )
  );

function validateVideoInput(model: string, prompt: string | null, imageCount: number) {
  if (model === "viduq1-text" && !prompt) return "`viduq1-text` requires a prompt.";
  if (["viduq1-image", "vidu2-image"].includes(model) && imageCount !== 1) {
    return `\`${model}\` requires exactly one source image.`;
  }
  if (["viduq1-start-end", "vidu2-start-end"].includes(model) && imageCount !== 2) {
    return `\`${model}\` requires exactly two source images.`;
  }
  if (model === "vidu2-reference" && (imageCount < 1 || imageCount > 3)) {
    return "`vidu2-reference` requires one to three source images.";
  }
  if (model === "cogvideox-3" && !prompt && imageCount === 0) {
    return "`cogvideox-3` needs at least a prompt or a source image.";
  }
  return null;
}

async function downloadAttachment(url: string): Promise<Blob> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error("Failed to download the Discord attachment.");
  }
  return await resp.blob();
}

function buildShareButton(shareId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`share_media:${shareId}`)
      .setLabel("Share Publicly")
      .setStyle(ButtonStyle.Secondary)
  );
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await ensureGuild(interaction.guildId);
  const userId = await ensureUser(interaction.user.id, interaction.guildId);
  const approved = await isUserApproved(userId);

  if (!approved) {
    await interaction.reply({
      content: "You need admin approval and budget before you can generate media.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (subcommand === "image") {
      const prompt = interaction.options.getString("prompt", true);
      const model = interaction.options.getString("model", true);
      const result = await generateImage(quota, {
        userId,
        discordUserId: interaction.user.id,
        prompt,
        model,
        size: interaction.options.getString("size") ?? undefined,
        quality: interaction.options.getString("quality") ?? undefined,
      });

      const imageResp = await fetch(result.url);
      if (!imageResp.ok) {
        throw new Error("Generated image could not be downloaded for Discord upload.");
      }
      const imageBlob = await imageResp.blob();
      const extension = imageBlob.type === "image/png" ? "png" : "jpg";
      const attachmentName = `routussy-image.${extension}`;
      const attachment = new AttachmentBuilder(Buffer.from(await imageBlob.arrayBuffer()), {
        name: attachmentName,
      });

      const shareId = saveSharePayload({
        userId: interaction.user.id,
        kind: "image",
        title: "Routussy Image",
        description: prompt,
        fields: [
          { name: "Model", value: `\`${result.model}\``, inline: true },
          { name: "Cost", value: `$${(result.costCents / 100).toFixed(2)}`, inline: true },
          { name: "Source URL", value: result.url },
        ],
        imageUrl: `attachment://${attachmentName}`,
        fileUrl: result.url,
        filename: attachmentName,
        createdAt: Date.now(),
      });

      const embed = new EmbedBuilder()
        .setTitle("Image Generated")
        .setColor(0x57f287)
        .setDescription(prompt)
        .addFields(
          { name: "Model", value: `\`${result.model}\``, inline: true },
          { name: "Cost", value: `$${(result.costCents / 100).toFixed(2)}`, inline: true },
          { name: "Image URL", value: result.url }
        )
        .setImage(`attachment://${attachmentName}`);

      await interaction.editReply({
        embeds: [embed],
        files: [attachment],
        components: [buildShareButton(shareId)],
      });
      return;
    }

    if (subcommand === "video") {
      const model = interaction.options.getString("model", true);
      const prompt = interaction.options.getString("prompt");
      const attachments = [
        interaction.options.getAttachment("image"),
        interaction.options.getAttachment("image2"),
        interaction.options.getAttachment("image3"),
      ].filter(Boolean) as Attachment[];

      const validationError = validateVideoInput(model, prompt, attachments.length);
      if (validationError) {
        await interaction.editReply({ content: validationError });
        return;
      }

      const result = await generateVideo(quota, {
        userId,
        discordUserId: interaction.user.id,
        model,
        prompt: prompt ?? undefined,
        imageUrls: attachments.map((attachment) => attachment.url),
        withAudio: interaction.options.getBoolean("with_audio") ?? undefined,
        aspectRatio: interaction.options.getString("aspect_ratio") ?? undefined,
      });

      const shareId = saveSharePayload({
        userId: interaction.user.id,
        kind: "video",
        title: "Routussy Video",
        description: prompt ?? "Generated from source image(s)",
        fields: [
          { name: "Model", value: `\`${result.model}\``, inline: true },
          { name: "Cost", value: `$${(result.costCents / 100).toFixed(2)}`, inline: true },
          { name: "Video URL", value: result.url },
        ],
        imageUrl: result.coverImageUrl,
        fileUrl: result.url,
        filename: "routussy-video.mp4",
        createdAt: Date.now(),
      });

      const embed = new EmbedBuilder()
        .setTitle("Video Generated")
        .setColor(0x57f287)
        .setDescription(prompt ?? "Generated from source image(s)")
        .addFields(
          { name: "Model", value: `\`${result.model}\``, inline: true },
          { name: "Cost", value: `$${(result.costCents / 100).toFixed(2)}`, inline: true },
          { name: "Video URL", value: result.url }
        );

      if (result.coverImageUrl) {
        embed.setImage(result.coverImageUrl);
      }

      await interaction.editReply({
        embeds: [embed],
        components: [buildShareButton(shareId)],
      });
      return;
    }

    if (subcommand === "ocr") {
      const file = interaction.options.getAttachment("file", true);
      const result = await parseLayout(quota, {
        userId,
        discordUserId: interaction.user.id,
        fileUrl: file.url,
        needLayoutVisualization: true,
      });

      const markdown = result.markdown || "No OCR text returned.";
      const truncated = markdown.length > 3500 ? markdown.slice(0, 3500) + "\n..." : markdown;
      const shareId = saveSharePayload({
        userId: interaction.user.id,
        kind: "ocr",
        title: "Routussy OCR Result",
        description: truncated,
        fields: [
          { name: "Model", value: `\`${result.model}\``, inline: true },
          { name: "Cost", value: `$${(result.costCents / 100).toFixed(2)}`, inline: true },
          { name: "Source File", value: file.url },
        ],
        imageUrl: result.visualizationUrls[0],
        createdAt: Date.now(),
      });

      const embed = new EmbedBuilder()
        .setTitle("OCR Complete")
        .setColor(0x57f287)
        .setDescription(truncated)
        .addFields(
          { name: "Model", value: `\`${result.model}\``, inline: true },
          { name: "Cost", value: `$${(result.costCents / 100).toFixed(2)}`, inline: true }
        );

      if (result.visualizationUrls[0]) {
        embed.setImage(result.visualizationUrls[0]);
      }

      await interaction.editReply({
        embeds: [embed],
        components: [buildShareButton(shareId)],
      });
      return;
    }

    if (subcommand === "transcribe") {
      const file = interaction.options.getAttachment("file", true);
      const contentType = file.contentType ?? "";
      if (!["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"].includes(contentType)) {
        await interaction.editReply({
          content: "Transcription currently supports WAV and MP3 uploads only.",
        });
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        await interaction.editReply({
          content: "That file is too large. Z.AI transcription supports files up to 25MB.",
        });
        return;
      }

      const blob = await downloadAttachment(file.url);
      const result = await transcribeAudio(quota, {
        userId,
        discordUserId: interaction.user.id,
        file: blob,
        filename: file.name,
        prompt: interaction.options.getString("prompt") ?? undefined,
        durationSeconds: file.duration,
      });

      const transcript = result.text || "No transcript returned.";
      const truncated = transcript.length > 3500 ? transcript.slice(0, 3500) + "\n..." : transcript;
      const shareId = saveSharePayload({
        userId: interaction.user.id,
        kind: "transcription",
        title: "Routussy Transcription",
        description: truncated,
        fields: [
          { name: "Model", value: `\`${result.model}\``, inline: true },
          { name: "Cost", value: `$${(result.costCents / 100).toFixed(2)}`, inline: true },
          { name: "Source Audio", value: file.url },
        ],
        createdAt: Date.now(),
      });

      const embed = new EmbedBuilder()
        .setTitle("Transcription Complete")
        .setColor(0x57f287)
        .setDescription(truncated)
        .addFields(
          { name: "Model", value: `\`${result.model}\``, inline: true },
          { name: "Cost", value: `$${(result.costCents / 100).toFixed(2)}`, inline: true }
        );

      await interaction.editReply({
        embeds: [embed],
        components: [buildShareButton(shareId)],
      });
      return;
    }
  } catch (err) {
    await interaction.editReply({
      content: err instanceof Error ? err.message : "Media generation failed.",
    });
  }
}

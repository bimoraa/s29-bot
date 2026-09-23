import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import * as calculator from "../__calculator.js";
import * as panel from "../../../discord/commands/panel.js";

const input_error_messages = new Set([
  "Expression is too long.",
  "Number is too large.",
  "Use only numbers, parentheses, and + - * / % ^.",
  "Expression has too many parts.",
  "Enter an expression first.",
  "A closing parenthesis is missing.",
  "That expression doesn't look right.",
  "Division by zero isn't allowed.",
  "The result is too large to calculate.",
]);

export const command = new SlashCommandBuilder()
  .setName("calc")
  .setDescription("Hitung ekspresi matematika dasar.")
  .addStringOption((option) => option
    .setName("expression")
    .setDescription("Pakai angka, kurung, +, -, *, /, %, dan ^.")
    .setMaxLength(200)
    .setRequired(true));

export async function handle(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {

  const expression = interaction.options.getString("expression", true);
  let result: number;

  try {
    result = calculator.evaluate_expression(expression);
  } catch (error) {
    if (!(error instanceof Error) || !input_error_messages.has(error.message)) {
      throw error;
    }

    await panel.send_template(
      interaction,
      "calc_error.json",
      {
        error_title: "Nggak bisa ngitung yang itu",
        error_message: error.message,
      },
      {
        fallback_title: "Nggak bisa ngitung yang itu",
        fallback_body: error.message,
        avatar_url: interaction.user.displayAvatarURL({ size: 256 }),
      },
    );
    return;
  }

  const formatted_result = new Intl.NumberFormat("en-US", {
    maximumSignificantDigits: 12,
  }).format(result);

  await panel.send_template(
    interaction,
    "calc.json",
    {
      expression,
      formatted_result,
      invoker_avatar_url: interaction.user.displayAvatarURL({ size: 256 }),
    },
    {
      fallback_title: "Hasilnyaa",
      fallback_body: `\`${expression}\` = **${formatted_result}**`,
      avatar_url: interaction.user.displayAvatarURL({ size: 256 }),
    },
  );

}

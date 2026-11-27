import { ChannelType, OverwriteType, PermissionFlagsBits } from "discord.js";
import type { DMChannel, GuildChannel, NonThreadGuildBasedChannel } from "discord.js";
import { eventStates, groupStates, persistGroupState } from "./state";
import { joinEvent } from "./eventCreation";
import { updateGroupMessages } from "./messageSync";

// Discord's Advanced permissions "+" adds a member with every permission left neutral, which in a
// private event/group channel lets them see nothing. When a member is added that way, let them in
// properly, as if they had clicked Join. An explicit deny is left alone.
export async function handleManualChannelAdds(
  oldChannel: DMChannel | NonThreadGuildBasedChannel,
  newChannel: DMChannel | NonThreadGuildBasedChannel,
): Promise<void> {
  if (newChannel.type !== ChannelType.GuildText || !("permissionOverwrites" in oldChannel)) return;
  const isEvent = eventStates.has(newChannel.id);
  const groupState = groupStates.get(newChannel.id);
  if (!isEvent && !groupState) return;

  const before = (oldChannel as GuildChannel).permissionOverwrites.cache;
  const guild = newChannel.guild;
  for (const [id, overwrite] of newChannel.permissionOverwrites.cache) {
    if (overwrite.type !== OverwriteType.Member || before.has(id)) continue;
    const view = PermissionFlagsBits.ViewChannel;
    if (overwrite.allow.has(view) || overwrite.deny.has(view)) continue;

    const member = await guild.members.fetch(id).catch(() => null);
    if (!member || member.user.bot) continue;

    if (isEvent) {
      const result = await joinEvent(guild, newChannel.id, member.user, member.displayName);
      if (result === "already") await newChannel.permissionOverwrites.edit(id, { ViewChannel: true, SendMessages: true });
    } else if (groupState) {
      await newChannel.permissionOverwrites.edit(id, { ViewChannel: true, SendMessages: true });
      if (!groupState.members.has(id)) {
        groupState.members.set(id, { userId: id, displayName: member.displayName });
        persistGroupState();
        await newChannel.send(`**${member.displayName}** joined.`);
        await updateGroupMessages(guild, newChannel.id);
      }
    }
    console.log(`Manual add in ${newChannel.name}: gave ${member.displayName} view access.`);
  }
}

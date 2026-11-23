export type RSVPStatus = "coming" | "maybe" | "decline" | "lurking";

export type MemberEntry = {
  userId: string;
  displayName: string;
  status: RSVPStatus;
};

export function makeMemberEntry(userId: string, displayName: string, status: RSVPStatus = "lurking"): MemberEntry {
  return { userId, displayName, status };
}

// Someone without a Discord account, added on the Edit Event page so the RSVP numbers add up.
export type PlaceholderPerson = { id: string; name: string; status: RSVPStatus };

export type EventState = {
  eventName: string;
  description: string;
  location: string;
  dateText: string;
  joinMessageId: string;
  pinMessageId: string;
  joiningEnabled: boolean;
  scheduledEventId?: string;
  endDateText?: string;
  creatorId?: string;
  // Off means no RSVP buttons: joining the channel is all there is. Missing (older events) means on.
  rsvpEnabled?: boolean;
  // Shown large on both event cards: an uploaded image (/event-images/…) or a link someone gave.
  imageUrl?: string;
  // Private events have no join card in the events channel: only people invited can join.
  private?: boolean;
  // Discord IDs of everyone sent an invite DM (they can join a private event, and see it in their calendar feed).
  invitedIds?: string[];
  // People without Discord, shown in the RSVP lists (only while RSVPs are on).
  placeholders?: PlaceholderPerson[];
  members: Map<string, MemberEntry>;
};

export type EditSession = {
  day: number | null;
  month: number | null;
  year: number | null;
  time: string | null;       // "HH:MM", "All Day", or null
  timeHour: number | null;   // null = show hour dropdown; 0-23 = show minute dropdown
  dayPage: "low" | "high";
};

export type GroupMemberEntry = {
  userId: string;
  displayName: string;
};

export type GroupState = {
  groupName: string;
  description: string;
  joinMessageId: string;
  pinMessageId: string;
  imageUrl?: string;
  members: Map<string, GroupMemberEntry>;
};

export type RSVPStatus = "coming" | "maybe" | "decline" | "lurking";

export type MemberEntry = {
  userId: string;
  displayName: string;
  status: RSVPStatus;
  plusOne: number;
};

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
  imageUrl?: string;
  creatorId?: string;
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

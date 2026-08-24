export type CatalogRecipientMode = "listing_team" | "custom" | "listing_team_and_custom";

function normalizedEmails(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter((value) => /^\S+@\S+\.\S+$/.test(value)))];
}

export function selectCatalogRecipients(
  mode: string,
  teamRecipients: string[],
  customRecipients: string[],
) {
  const team = normalizedEmails(teamRecipients);
  const custom = normalizedEmails(customRecipients);
  if (mode === "custom") return custom;
  if (mode === "listing_team_and_custom") return normalizedEmails([...team, ...custom]);
  return team;
}

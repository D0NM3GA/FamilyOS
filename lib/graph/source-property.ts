/**
 * The extended property the calendar write-back (Phase 17) tags every event it writes with, so an
 * orphan can be traced even without its link. Phase 70a: the Outlook copy reads it to leave those
 * events out, since the app already shows what they mirror.
 */
export const SOURCE_PROPERTY_ID = "String {5b6a2d4e-8f0c-4c8e-9f3b-2a7d1e6c9b10} Name FamilyOSSourceKey";

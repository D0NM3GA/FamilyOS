import { z } from "zod";

/**
 * Phase 64b: one event a grown-up adds to their Outlook calendar from the app (the owner's call:
 * a simple add; changing or deleting it stays in Outlook). Pure: the form's fields in, Graph's
 * event body out, with Graph's own rules (an all-day event runs midnight to the next midnight in
 * one zone; a timed one is a wall-clock time and its zone). No app tag: the Outlook sync only ever
 * changes events it made (lib/calendar-sync), so it leaves this one alone.
 */

const clock = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const newEventSchema = z
  .object({
    title: z.string().trim().min(1, "Give it a name").max(200, "That name is too long"),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day"),
    start: z.union([z.literal(""), z.string().regex(clock, "Pick a start time")]),
    end: z.union([z.literal(""), z.string().regex(clock, "Pick an end time")]),
    /** A household member's first name, put before the title ("Ivy: Dentist"), or "". */
    who: z.string().trim().max(80, "That name is too long"),
    /** Made when the form was drawn: Outlook skips a second create with the same one (a retry). */
    transactionId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  })
  .refine((v) => !Number.isNaN(Date.parse(`${v.day}T00:00:00Z`)) && new Date(`${v.day}T00:00:00Z`).toISOString().slice(0, 10) === v.day, {
    message: "Pick a day",
    path: ["day"],
  })
  .refine((v) => !(v.end && !v.start), { message: "Give a start time too, or neither", path: ["start"] })
  .refine((v) => !(v.start && v.end && v.end <= v.start), { message: "The end has to be after the start", path: ["end"] });

export type NewEvent = z.infer<typeof newEventSchema>;

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const plusHour = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  // A timed event with no end lasts an hour, kept on its day (23:30 ends at 23:59).
  // (A start of 23:59 ends at 23:59: Graph takes an end equal to the start.)
  const minutes = Math.min(h * 60 + m + 60, 23 * 60 + 59);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
};

export function newEventPayload(e: NewEvent, timeZone: string) {
  const subject = e.who ? `${e.who}: ${e.title}` : e.title;
  if (!e.start) {
    return {
      subject,
      isAllDay: true,
      start: { dateTime: `${e.day}T00:00:00`, timeZone },
      end: { dateTime: `${nextDay(e.day)}T00:00:00`, timeZone },
      transactionId: e.transactionId,
    };
  }
  return {
    subject,
    isAllDay: false,
    start: { dateTime: `${e.day}T${e.start}:00`, timeZone },
    end: { dateTime: `${e.day}T${e.end || plusHour(e.start)}:00`, timeZone },
    transactionId: e.transactionId,
  };
}

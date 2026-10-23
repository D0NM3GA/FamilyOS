import { requireAppOn } from "@/lib/app-guard";
import { currentHour } from "@/lib/bunson-moments";
import { getHouseholdSettings } from "@/lib/household-settings";
import { careHoursToday } from "@/lib/pet/care-hours";
import { getCareHours, getMyPet, type PetRecord } from "@/lib/pet/queries";
import { seasonOf, skyAt, weatherFrom } from "@/lib/pet/room";
import { hashString } from "@/lib/pet/random";
import { STAGE_MINUTES } from "@/lib/pet/state";
import { formName, moodLine } from "@/lib/pet/words";
import { pageTitle } from "@/components/styles";
import { getDailyForecast } from "@/lib/weather";
import { HatchPanel } from "./hatch-panel";
import { PetScreen, type ScreenPet } from "./pet-screen";

export const metadata = { title: "Pet" };

function toScreen(pet: PetRecord): ScreenPet {
  const { state } = pet;
  const napping = pet.minute < state.napUntil;
  return {
    name: pet.name,
    species: state.species,
    stage: state.stage,
    form: state.form,
    formName: formName(state.species, state.stage, state.form),
    hunger: state.hunger,
    fun: state.fun,
    energy: state.energy,
    discipline: state.discipline,
    weight: state.weight,
    poops: state.poops,
    sick: state.sick,
    call: state.call?.kind ?? null,
    napping,
    awake: pet.awake,
    ageDays: Math.floor(state.ageMinutes / (6 * 60)),
    mood: moodLine({ name: pet.name, species: state.species, personality: pet.personality, seed: pet.seed }, state, pet.awake, napping, pet.minute),
    // Not the pet's own seed: that one decides sickness and presents, so it stays on the server.
    seed: hashString(`${pet.seed}:view`).toString(36),
    personality: pet.personality,
    minute: pet.minute,
    hatchesIn: state.stage === "egg" ? STAGE_MINUTES.egg - state.stageMinutes : null,
  };
}

/**
 * Phase 47: the pet. Everyone's own: a kid sees their pet (or picks an egg), never anyone
 * else's. Separate from points and the Store on purpose (the owner's call).
 */
export default async function PetPage() {
  const profile = await requireAppOn("pet");
  const now = new Date();
  const [mine, household, { careHours, timeZone }] = await Promise.all([
    getMyPet(profile, now),
    getHouseholdSettings(profile.householdId),
    getCareHours(profile.householdId),
  ]);

  if (!mine.pet) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        <h1 className={pageTitle}>Pet</h1>
        <HatchPanel goodbye={mine.goodbye} />
      </div>
    );
  }

  // The window shows today: the household's clock, season and forecast (cached, never throws).
  const forecast = await getDailyForecast(household.latitude, household.longitude);
  const hour = currentHour(timeZone, now);
  const month = Number(new Intl.DateTimeFormat("en-US", { month: "numeric", timeZone }).format(now)) - 1;
  const today = forecast?.find((period) => period.isDaytime) ?? forecast?.[0];

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <h1 className="sr-only">Pet</h1>
      <PetScreen
        pet={toScreen(mine.pet)}
        items={mine.items}
        presents={mine.presents}
        tricks={mine.tricks}
        newTricks={mine.newTricks}
        reveal={mine.reveal}
        sky={skyAt(hour)}
        weather={weatherFrom(today?.shortForecast)}
        season={seasonOf(month)}
        careHours={careHoursToday(careHours, timeZone, now.getTime())}
      />
    </div>
  );
}

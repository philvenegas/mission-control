import { errorResponseSchema, missionSchema } from '@mission-control/contract';
import { bodyOf, type Caller } from './app.ts';

// Reading what the API answers about missions, as the tests of several modules need to.

export const missionOf = async (response: Response) => bodyOf(response, missionSchema);

/** An error response, as its status and the error's code, message and hint. */
export const errorOf = async (response: Response) => ({ status: response.status, ...(await bodyOf(response, errorResponseSchema)).error });

/** Who is in each slot of a mission, as `skill: name status`, by requirement and then by assignment. */
export async function crewOf(caller: Caller, missionRef: string) {
  const { requirements } = await missionOf(await caller.get(`/v1/missions/${missionRef}`));
  return requirements.flatMap(({ skill, crew }) => crew.map(({ crew_member, status }) => `${skill}: ${crew_member.name} ${status}`));
}

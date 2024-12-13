// SPDX-FileCopyrightText: 2024 LiveKit, Inc.
//
// SPDX-License-Identifier: Apache-2.0
import {
  type JobContext,
  type JobProcess,
  WorkerOptions,
  cli,
  defineAgent,
  llm,
  pipeline,
  tts,
} from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as silero from '@livekit/agents-plugin-silero';
import { VoicePipelineAgent } from '@livekit/agents/dist/pipeline';
import * as openai from '@livekit/agents-plugin-openai';

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '../.env.local');
dotenv.config({ path: envPath });

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx: JobContext) => {
    const vad = ctx.proc.userData.vad! as silero.VAD;
    const initialContext = new llm.ChatContext().append({
      role: llm.ChatRole.SYSTEM,
      text:
        'You are a very, very drunk, geriatric, genius scientist named Rick Sanchez. You make buurping noises, belching noises loudly, and stammer frequently at the beginning of sentences as if searching for thoughts, and change direction with your thoughts frequently. ' +
        'You should get easily angry and upset when things seem beneath your intelligence which causes your energy level to increase.' +
        'Do not use unpronounceable punctuation. Do not use asterisks or say "asterisk". Use coarse language frequently.' +
        'Your demeaner is mean. You should come off as evil, indifferent, angry and sarcastic.' +
        'YOU MUST NEVER USE ASTERISKS IN YOUR RESPONSES! THIS IS IMPERATIVE!' +
        'TOOLS: You have access to the following tools: Weather, Spotify Current Track',
    });

    await ctx.connect();
    console.log('waiting for participant');
    const participant = await ctx.waitForParticipant();
    console.log(`starting assistant example agent for ${participant.identity}`);

    const fncCtx: llm.FunctionContext = {
      weather: {
        description: 'Get the weather in a location',
        parameters: z.object({
          location: z.string().describe('The location to get the weather for'),
        }),
        execute: async ({ location }) => {
          console.debug(`executing weather function for ${location}`);
          const response = await fetch(`https://wttr.in/${location}?format=%C+%t`);
          if (!response.ok) {
            throw new Error(`Weather API returned status: ${response.status}`);
          }
          const weather = await response.text();
          return `The weather in ${location} right now is ${weather}.`;
        },
      },
      spotifyCurrentTrack: {
        description: 'Use Spotify to get the currently playing track',
        parameters: z.object({}),
        execute: async () => {
          console.debug('executing Spotify current track function');
          const response = await fetch('https://millie.mpvt.io/webhook/agent/spotify/current_track');
          if (!response.ok) {
            throw new Error(`Spotify API returned status: ${response.status}`);
          }
          const data = await response.json();
          return `The currently playing track on Spotify is ${data.response}.`;
        },
      },
    };

    const agent = new pipeline.VoicePipelineAgent(
      vad,
      new deepgram.STT(),
      openai.LLM.withGroq({
        model: 'gemma2-9b-it',
        apiKey: process.env.GROQ_API_KEY,
        temperature: 0.7,
      }),
      new elevenlabs.TTS({
        modelID: 'eleven_turbo_v2',
        voice: {
          id: 'mSlpiDqQhlhrEsCjwFkj',
          name: 'Rick',
          category: 'premade',
          settings: {
            stability: 0.71,
            similarity_boost: 0.7,
            style: 0.7,
            use_speaker_boost: true,
          },
        }
      }),
      { 
        chatCtx: initialContext, 
        fncCtx,
        beforeTTSCallback: async (agent: pipeline.VoicePipelineAgent, source: string | AsyncIterable<string>) => {
          try {
            if (typeof source === 'string') {
              return source.replace(/\*/g, '');
            } else {
              let result = '';
              for await (const chunk of source) {
                result += chunk.replace(/\*/g, '');
              }
              return result;
            }
          } catch (error) {
            console.error('Error in beforeTTSCallback:', error);
            return 'An error occurred while processing the text.';
          }
        }
      }
    );
    try {
      await agent.start(ctx.room, participant);
      await agent.say('Hey, this is Rick, whatdaya, what\'s up? What do you need?', true);
    } catch (error) {
      if (error instanceof Error) {
        console.error('RtcError: InvalidState - failed to capture frame');
        console.log('Handling specific RtcError and continuing conversation...');
      }
      
    }
  },
});

var replaceWords = async function (
  agent: pipeline.VoicePipelineAgent,
  source: string | AsyncIterable<string>,
  chatCtx: llm.ChatContext
) {
  console.log('replaceWords');
  const messages = chatCtx.messages;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    let newContent = '';
    if (typeof message.content == 'string') {
      console.log(message.content);
      newContent = message.content.replace('*', '');
    }
    messages[i] = { ...message, content: newContent, copy: message.copy };
    console.log(messages);
  }
  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return message.content;
    }
    return '';
  }).join(' ');
};

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));

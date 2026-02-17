import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const QUALTRICS_API_TOKEN = Deno.env.get("QUALTRICS_API_TOKEN");
const QUALTRICS_SURVEY_ID = Deno.env.get("QUALTRICS_SURVEY_ID");
const QUALTRICS_DATACENTER = Deno.env.get("QUALTRICS_DATACENTER");
const SYLLABUS_LINK = Deno.env.get("SYLLABUS_LINK") || "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

    // to populate list options
  if (req.method === "GET") {
    const files: string[] = [];

    for await (const entry of Deno.readDir("./1026_midterm_transcripts")) {
      if (entry.isFile && entry.name.endsWith(".txt")) {
        files.push(entry.name);
      }
    }

    return new Response(JSON.stringify(files), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", },
    });
  }

// Post method
  if (req.method === "POST") {
        const body = await req.json();
        const transcript = body.transcript;

        if (!transcript) {
            return new Response("No transcript provided", {
              headers: corsHeaders,
              status: 400,
            });
        }

        // SECURITY: prevent path traversal
        if (!transcript.endsWith(".txt")) {
          return new Response("Invalid file, not txt", {
            headers: corsHeaders,
            status: 400,
          });
        }

        const filePath = `./1026_midterm_transcripts/${transcript}`;

        let transcriptContent: string;

        try {
          transcriptContent = await Deno.readTextFile(filePath);
        } catch {
          return new Response("Error reading transcript", {
            headers: corsHeaders,
            status: 404,
          });
        }

        if (!GEMINI_API_KEY) {
          return new Response("Missing GEMINI API key", { status: 500 });
        }

        // Send transcriptContent to Gemini
        const prompt = `
            You are an academic instructor and want to help student to prepare for exams.

            The following is a lecture content delivered by Dan in class. Using ONLY the content to generate 5 multiple choice questions high on Bloom's taxonomy for student to practice.
            Requirements:
            - Each question must be directly answerable using the lecture content.
            - Do NOT include the words "transcript", "speaker", "lecturer", or any synonym referring to the source format.
            - You must refer to the instructor only as "Dan" or "the prof".
            - Do NOT use outside knowledge.
            - Only one correct answer per question, high on Bloom's taxonomy, focused on understanding of key concepts and ideas.
            - Provide the correct answer clearly after each question.
            - Questions should test understanding, focusing on the idiosyncratic and political arguments of the lecture.

          Lecture Content:
          ${transcriptContent}
          `;

      const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                { text: prompt }
                ],
              },
            ],
            generationConfig: {
              temperature: 0.2, // controls creativity
              maxOutputTokens: 10000,
            },
        }),
      });

      const geminiJson = await geminiResponse.json();
      const baseResponse =
          geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ||
          "No response from Gemini";
      const result = `${baseResponse}\n\nThere may be errors in my responses; always refer to the course web page: ${SYLLABUS_LINK}`;

    let qualtricsStatus = "Qualtrics not called";

    if (QUALTRICS_API_TOKEN && QUALTRICS_SURVEY_ID && QUALTRICS_DATACENTER) {
        const qualtricsPayload = {
          values: {
            responseText: result,
            lectureName: transcript,
          },
        };

        const qt = await fetch(`https://${QUALTRICS_DATACENTER}.qualtrics.com/API/v3/surveys/${QUALTRICS_SURVEY_ID}/responses`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-TOKEN": QUALTRICS_API_TOKEN,
          },
          body: JSON.stringify(qualtricsPayload),
        });

        qualtricsStatus = `Qualtrics status: ${qt.status}`;
    }

    return new Response(`${result}\n<!-- ${qualtricsStatus} -->`, {
        headers: {
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "*",
        },
    });
  }
});

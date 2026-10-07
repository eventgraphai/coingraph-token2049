// MIP-003 input schema: one plain-language request, the same way a person briefs the Coworker on Sokosumi.
export async function GET() {
  return Response.json({
    input_data: [
      {
        id: "request",
        type: "string",
        name: "Request",
        data: {
          description: "What to check, in plain words. Examples: 'Check LINK before I buy $5K', 'Is 0x28c6c06298d514db089934071355e5743bf21d60 safe to send to on Ethereum?', 'Due diligence on Cardano'.",
          placeholder: "Check LINK before I buy $5K",
        },
        validations: [{ validation: "min", value: "3" }, { validation: "max", value: "4000" }],
      },
    ],
  });
}

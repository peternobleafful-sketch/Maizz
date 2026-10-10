# Maizz design.md

Maizz is a giving platform for churches in Ghana. Givers give tithes and offerings by mobile money from their phones. Churches see what has been given. This file is the design system. Follow it exactly.

## 1. Feel
Bold, flat electric blue. Large confident type. Rounded surfaces. Calm and trustworthy, because people are giving money. Modern fintech, not a charity poster. Mobile first: most givers use a mid-range Android phone on a patchy connection.

Inspiration: the attached images (atom.money style: electric blue, soft blurred gradient heroes, white cards on blue, clean grotesque type, rounded phone UI). Take the mood, never copy their layouts, logo, coins or wording.

## 2. Colour
| Token | Hex | Use |
|---|---|---|
| blue | #011BFF | Brand. Heroes, primary buttons, links, focus |
| blue-deep | #0012C9 | Hover, pressed, gradient depth |
| blue-glow | #7C8CFF | Soft glow in hero gradients only |
| ink | #0A0A0F | Text, ink logo |
| paper | #FFFFFF | Sheets, cards, white logo on blue |
| mist | #EEF0FF | Soft backgrounds, chips |
| line | #D6DAF7 | Borders, dividers |
| mute | #5A5F7A | Secondary text |
| lime | #B8F23C | Success only (paid, tick, PASS tags) |
| danger | #C4182C | Errors only |

Rules: gradients only in hero areas (soft radial glow top right, deeper blue bottom left). Everything else flat. Text on blue is white. Text on white is ink. Body text contrast at least 4.5:1. Never use black and gold (dropped on 10 Oct 2026).

## 3. Type
- Outfit for everything: headlines, body, buttons.
- DM Mono for money references, codes, receipt lines and small labels.
- Amount input on the giving page is huge (about 56 to 72px, semi-bold). Headlines 28 to 40px. Body 16px minimum on phones. Buttons 17px semi-bold.
- Sentence case everywhere. No all-caps except tiny mono labels with letter-spacing.
- Numbers use tabular figures.

## 4. Shape, space, depth
- Radius: buttons and inputs 16px, cards 24px, hero sheet top corners 32px, chips fully round.
- Spacing scale 4, 8, 12, 16, 24, 32, 48. Side gutter 20px on phones.
- Touch targets at least 48px high.
- Shadows rare and soft. Prefer colour and space to borders.

## 5. Logo
Files: public/brand/maizz-logo-ink.png, maizz-logo-white.png, maizz-mark-ink.png, maizz-mark-white.png. White logo on blue, ink logo on white. Clear space equal to the height of the "M" lobe. Never recolour, stretch, outline or put on a busy background. Use the mark alone for app icon and favicon.

## 6. Components
- Primary button: full width on phones, blue fill, white text, 56px high, pressed state darker. Disabled is mist with mute text.
- Secondary button: white with blue text and a line border.
- Input: 56px, white, line border, blue border and soft ring on focus. Label above, never a placeholder-only label.
- Chips (gift type, network, quick amounts 20, 50, 100, 200): round, mist fill, selected is blue fill with white text.
- Receipt summary: three rows, Gift, Fees, Total, DM Mono amounts with dotted leaders, total in bold. Underneath: "{Church} receives the full GH₵X".
- Status tags: lime PASS, dashed-blue FIX, danger FAILED, mute WAITING.
- Hero sheet: blue hero on top, one white sheet with rounded top corners rising over it.
- Toasts and inline messages: short, plain, say what to do next.

## 7. Money display
Always "GH₵" then amount with two decimals and thousands commas: GH₵1,250.00. Store whole pesewas, show cedis. Fee line reads Gift + Fees = Total. Gifts from GH₵1 to GH₵50,000.

## 8. Motion
Gentle. Pulsing ring while waiting for approval on the phone. Self-drawing tick on success. Short fades and slides under 250ms. Respect prefers-reduced-motion: turn all motion off.

## 9. Accessibility
Visible focus ring (blue, 3px). Labels on every field. Errors in text, not colour alone. Works at 320px wide. Works with large system text. Phone number field uses a numeric keypad.

## 10. Copy
Plain, warm, short. Active voice. Buttons say what happens: "Give GH₵50.00". Errors say what went wrong and what to do. British spelling. No jargon.
Always: "You approve the payment on your phone. Maizz never sees your PIN."
Never: the word "Paystack" or any payment provider name anywhere givers can see. Givers see only "Maizz".
Never show an in-app pay button inside the iPhone app. The app opens the web checkout page.

## 11. Do and don't
Do: big amount first, one clear action per screen, show the church name early, show test-mode pill while in test mode.
Don't: stock photos of cash, preachy religious clichés, dark patterns, countdown pressure, more than one gradient per screen, tiny grey text.

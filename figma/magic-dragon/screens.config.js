/* What build.js cannot read from the HTML: how screens are grouped on the Screens
   page, the design note under each frame, and names for colours, text styles and
   components. Patterns match the screen id (the file name without its number).
   New screens land in the first section whose pattern matches; the first note
   pattern that matches wins, so specific patterns come first. A "note" field on a
   screen in direction.json overrides these. */

module.exports = {
  title: "Magic Dragon",
  subtitle: "iPhone app, Gallery direction · 2026",

  /* checked in this order; the page shows them in "show" order */
  sections: [
    { name: "Edge cases", match: /closed|empty|problem|issue|error|offline|unavailable|sold-?out/ },
    { name: "Account", match: /sign-?in|login|(^|-)code($|-)|verify|otp|account|profile|declined|denied|location-off/ },
    { name: "Orders and tracking", match: /order|track|receipt|deliver|placed|confirm|arriving|heading/ },
    { name: "Onboarding", match: /launch|splash|welcome|age|21|location|address|intro/ },
    { name: "Shopping", match: /home|menu|category|search|product|added|bag|cart|checkout|browse/ }
  ],
  show: ["Onboarding", "Shopping", "Account", "Orders and tracking", "Edge cases"],
  fallbackSection: "More screens",

  /* Design notes come from direction.json (then the prototype's FRAMES in app.js, then
     the patterns below). Add a pattern here to force the note below for a screen. */
  overrideNotes: [],

  notes: [
    [/closed/, "Closed is a state, not a dead end: the menu stays open to browse, the next opening time leads, and Add buttons say when ordering opens instead of failing at checkout."],
    [/empty/, "An empty bag offers a next step, the last order to reorder and a few popular picks, rather than an illustration and an apology."],
    [/problem|issue|error/, "Problems use plain words and one clear action. Call the store is always there, because a person fixes a delivery faster than a form."],
    [/declined|denied/, "Declining location never blocks the app: the customer types a town instead. One quiet link back to Settings, no guilt copy."],
    [/sign-?in|login|phone/, "Phone number only. A one-time code replaces a password, which suits an app people open a few times a month."],
    [/(^|-)code($|-)|verify|otp/, "The code fills in from the text message on iPhone. Resend unlocks after 30 seconds, so an impatient tap can't send a second code."],
    [/account|profile|settings/, "Account holds the few things people change: address, phone, notifications. Delete account sits in plain view, as the App Store requires."],
    [/placed|confirm|success/, "The confirmation answers what people ask next, when it arrives and how to pay. The order number is there, but second."],
    [/receipt/, "The receipt names the licensed seller and lists every line that makes up the total, so it works as a record."],
    [/preparing/, "While the store prepares the order, the screen shows the window already promised, never a raw estimate that could jump around."],
    [/delivered|complete/, "Delivered shows when it arrived and links the receipt, then gets out of the way."],
    [/driver|heading|arriving|last-leg/, "Driver shows only on the last leg: protects other customers' locations. The marker glides between GPS fixes instead of jumping."],
    [/track|on-the-way/, "The arrival window leads, because that is why people open this screen. Stops before yours are a count, never a map; the driver appears only on the last leg, which protects other customers' locations."],
    [/orders/, "Active orders sit on top with live status. Past orders lead with Reorder, the most common next step."],
    [/launch|splash/, "A purple line draws the dragon in 14 strokes over 1.3 s, head first and eyes last. The fill fades in as the lines fade out, the wordmark rises 8 pt, and the screen holds until 2.5 s before cross-fading into Home. If the menu is still loading, the line fades to a ghost and redraws until it arrives. Reduce Motion shows the finished mark."],
    [/address/, "The delivery address is typed and confirmed, not guessed from GPS, because the driver needs a door, not a dot."],
    [/welcome|age|21/, "Age and location are one short checklist instead of two walls. The 21+ answer stays visible with a Change link, and location is asked for with its reason: it picks the store, not the door."],
    [/location/, "Asks for rough location only and says why: it picks which store's menu you see. The map shows an area, never a pin."],
    [/home/, "Open state and ETA lead, because they decide whether to order at all. Photos do the selling; purple is saved for the things that add to the bag."],
    [/search/, "Search opens on recent and popular terms so the empty state is useful. Results reuse the menu card, so there is nothing new to learn."],
    [/added/, "Adding confirms in place with the new bag total instead of jumping to the bag: most orders have more than one item."],
    [/product/, "One big photo, then the three facts people compare first: THC, size and lab date. The required warning stays readable but quiet, under the description."],
    [/menu|category|catalog/, "Categories are one row of tabs; brand, size and THC sit under every name, so people compare without opening each product."],
    [/checkout/, "Checkout repeats only what can still change: address, time and total. Payment happens at the door, so there is no card form."],
    [/bag|cart/, "Payment and the ID check are stated before checkout, because both happen at the door. The total includes fees and taxes, so nothing changes at the end."]
  ],

  /* prototype: the flow starts here; a launch screen with no tap target moves on by itself */
  flow: { name: "Prototype", start: /launch|splash/, fallbackStart: /welcome/, autoAdvanceSeconds: 1.8 },

  /* Gallery CSS variable -> Figma variable name and description */
  tokens: {
    canvas: ["Surface/Canvas", "App background"],
    surface: ["Surface/Default", "Cards, sheets and bars"],
    tile: ["Surface/Tile", "Behind product photos and icons"],
    tint: ["Surface/Brand tint", "Soft purple behind secondary actions and done steps"],
    ink: ["Text/Primary", "Titles and body text"],
    ink2: ["Text/Secondary", "Supporting text"],
    ink3: ["Text/Tertiary", "Hints, inactive tabs, fine print"],
    line: ["Border/Default", "Card borders and dividers"],
    purple: ["Brand/Purple", "Actions and progress only"],
    green: ["Status/Success", "Open, live, delivered"],
    warn: ["Status/Warning", "Store closed, order problems"],
    "warn-bg": ["Surface/Warning tint", "Behind warning notices"]
  },
  extraTokens: [
    ["Text/On brand", "#FFFFFF", "Text and icons on purple"],
    ["Brand/Purple pressed", "#3A0A66", "Pressed primary button"],
    ["Brand/Yellow", "#F3DA14", "Accent from the logo, used sparingly"],
    ["Brand/Yellow pale", "#FFF4A3", "Soft accent"],
    ["Border/Strong", "#DEDBD6", "Sheet grabber"],
    ["Map/Land", "#E9E6E0", "Drawn map: land"],
    ["Map/Park", "#DAE4D1", "Drawn map: parks"],
    ["Map/Water", "#D3DDE2", "Drawn map: water"],
    ["Map/Casing", "#DEDAD3", "Drawn map: road edges"],
    ["Device/Ink", "#0B0B0D", "Home indicator"]
  ],
  tokenGroups: ["Surface", "Text", "Brand", "Status", "Border", "Map", "Device"],

  /* size/weight -> text style name. Extra line heights get the line height appended. */
  typeNames: {
    "32/600": "Display/Large title", "28/600": "Display/Title", "26/600": "Display/Number", "24/600": "Heading/Large",
    "22/600": "Heading/Title", "22/700": "Heading/Title bold", "20/600": "Heading/Section", "18/600": "Heading/Small",
    "17/600": "Body/Headline", "17/500": "Body/Input", "17/400": "Body/Large", "11/600": "Caption/Badge", "16/600": "Label/Button", "16/500": "Label/Medium", "16/400": "Body/Callout",
    "15/400": "Body/Default", "15/500": "Body/Link", "15/600": "Body/Strong",
    "14/400": "Body/Small", "14/500": "Label/Small", "14/600": "Label/Small strong",
    "13/400": "Caption/Default", "13/500": "Caption/Medium", "13/600": "Caption/Strong",
    "12/400": "Caption/Small", "12/500": "Caption/Small medium", "12/600": "Caption/Small strong",
    "11/400": "Caption/Fine", "10/500": "Caption/Tab", "10/600": "Caption/Tab strong"
  },

  setOrder: ["Button", "Chip", "Product card", "Bag row", "Add button", "Stepper", "Progress", "Status card", "Driver card", "Driver badge", "Pulse dot", "Tab bar", "iOS keyboard", "Status bar", "Home indicator"],
  componentDocs: {
    "Button": "One primary action per screen. Purple only for the action that moves the order forward; pressed darkens to Purple pressed, disabled drops to 40%.",
    "Chip": "Category filters: plain chips under the title, one tap each.",
    "Product card": "Featured on Home leads with the photo. Grid on the menu adds brand, size and THC. In cart swaps the add button for a stepper on the photo, so you keep browsing.",
    "Bag row": "One product line. In the bag it carries a quantity stepper; on the receipt, the quantity and unit price.",
    "Add button": "32 pt purple square in the photo corner, so adding never needs the product page.",
    "Stepper": "Large next to Add to bag on the product page, Small in each bag row, On photo once a card is in the cart.",
    "iOS keyboard": "System keyboard, drawn so the address, search, sign-in and code screens read as real: letters, or the number pad with the code from Messages.",
    "Progress": "Four steps that match the stages the order service sends. Steps ahead of the current one are dimmed.",
    "Status card": "Order status card used on order details.",
    "Driver card": "Shown only on the last leg. Live is full strength; Updated and Last seen fade the photo so an old position never looks current.",
    "Driver badge": "The map marker: the dragon on purple with a white ring. Faded when the last GPS fix is old.",
    "Pulse dot": "Live indicator. The ring grows 1x to 2.4x and fades over 1.6 s; Reduce Motion keeps only the solid dot.",
    "Tab bar": "Four destinations. The active tab is purple, the rest tertiary ink.",
    "Status bar": "iOS status bar: dark on light screens, light on photos and maps.",
    "Home indicator": "iOS home indicator, matched to the status bar."
  }
};

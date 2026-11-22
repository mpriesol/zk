import type { Motto } from "./types.ts";

/**
 * Short public-domain excerpts, selected through LibQuotes and checked against
 * the named original works. Slovak wording is our translation, not a claim of
 * an existing published Slovak edition. Sources stay editable in administration.
 */
export const DEFAULT_MOTTOS: Motto[] = [
  {
    id: "emerson-enthusiasm",
    text: "Nič veľké sa nikdy nedosiahlo bez nadšenia.",
    author: "Ralph Waldo Emerson",
    originalText: "Nothing great was ever achieved without enthusiasm.",
    sourceWork: "Essays: First Series (1841), Circles",
    sourceUrl: "https://libquotes.com/ralph-waldo-emerson/quote/lbg3g8q",
    translation: true,
    active: true,
    order: 1,
  },
  {
    id: "epictetus-patience",
    text: "Žiadna veľká vec nevznikne zo dňa na deň.",
    author: "Epiktétos",
    originalText: "No great thing is created suddenly.",
    sourceWork:
      "Discourses, kniha I, kapitola 15; anglický preklad Elizabeth Carter",
    sourceUrl: "https://libquotes.com/epictetus/quote/lbw9a6s",
    translation: true,
    active: true,
    order: 2,
  },
  {
    id: "stevenson-journey",
    text: "Cestovať s nádejou je lepšie než doraziť do cieľa.",
    author: "Robert Louis Stevenson",
    originalText: "To travel hopefully is a better thing than to arrive.",
    sourceWork: "Virginibus Puerisque (1881), El Dorado; úryvok",
    sourceUrl: "https://libquotes.com/robert-louis-stevenson/quote/lbr2o9l",
    translation: true,
    active: true,
    order: 3,
  },
  {
    id: "emerson-friendship",
    text: "Jediný spôsob, ako mať priateľa, je byť priateľom.",
    author: "Ralph Waldo Emerson",
    originalText: "The only way to have a friend is to be one.",
    sourceWork: "Essays: First Series (1841), Friendship; úryvok",
    sourceUrl: "https://libquotes.com/ralph-waldo-emerson/quote/lbv9d6o",
    translation: true,
    active: true,
    order: 4,
  },
  {
    id: "thoreau-seasons",
    text: "Ži v každom ročnom období tak, ako prichádza.",
    author: "Henry David Thoreau",
    originalText: "Live in each season as it passes.",
    sourceWork: "Journal, 23. augusta 1853; úryvok",
    sourceUrl: "https://libquotes.com/henry-david-thoreau/quote/lbo8v4n",
    translation: true,
    active: true,
    order: 5,
  },
  {
    id: "marcus-community",
    text: "Čo neprospieva úľu, neprospieva ani včele.",
    author: "Marcus Aurelius",
    originalText:
      "That which is not in the interests of the hive cannot be in the interests of the bee.",
    sourceWork: "Meditations VI.54; anglický preklad C. R. Haines (1916)",
    sourceUrl: "https://libquotes.com/marcus-aurelius/quote/lbs2f5t",
    translation: true,
    active: true,
    order: 6,
  },
  {
    id: "johnson-perseverance",
    text: "Veľké diela vznikajú vytrvalosťou, nie silou.",
    author: "Samuel Johnson",
    originalText:
      "Great works are performed not by strength, but perseverance.",
    sourceWork: "The History of Rasselas, Prince of Abissinia (1759); úryvok",
    sourceUrl: "https://libquotes.com/samuel-johnson/quote/lbp7y5y",
    translation: true,
    active: true,
    order: 7,
  },
  {
    id: "eliot-kindness",
    text: "Načo žijeme, ak nie preto, aby sme si navzájom uľahčovali život?",
    author: "George Eliot",
    originalText:
      "What do we live for, if it is not to make life less difficult to each other?",
    sourceWork: "Middlemarch (1871–1872), kapitola 72; slová postavy Dorothey",
    sourceUrl: "https://libquotes.com/george-eliot/quote/lbe4w7y",
    translation: true,
    active: true,
    order: 8,
  },
];

/** Primary editions supporting the curated catalog (not participant tracking). */
export const MOTTO_PRIMARY_SOURCES: Record<string, string> = {
  "emerson-enthusiasm":
    "https://www.gutenberg.org/files/2944/2944-h/2944-h.htm",
  "emerson-friendship":
    "https://en.wikisource.org/wiki/Essays:_First_Series/Friendship",
  "epictetus-patience":
    "https://en.wikisource.org/wiki/The_Works_of_Epictetus,_His_Discourses,_in_Four_Books,_the_Enchiridion,_and_Fragments/Book_1/Chapter_15",
  "stevenson-journey":
    "https://en.wikisource.org/wiki/Virginibus_Puerisque_and_Other_Papers/El_Dorado",
  "thoreau-seasons": "https://assets.press.princeton.edu/chapters/s8792.pdf",
  "marcus-community":
    "https://en.wikisource.org/wiki/Marcus_Aurelius_(Haines_1916)/Book_6",
  "johnson-perseverance": "https://www.gutenberg.org/files/652/652-h/652-h.htm",
  "eliot-kindness":
    "https://en.wikisource.org/wiki/Middlemarch_(1874)/Chapter_72",
};

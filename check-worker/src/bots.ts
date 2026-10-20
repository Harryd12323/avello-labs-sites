// AI and search crawlers covered by the AI crawler check. Each description is based on the company's own
// crawler documentation (linked). Last reviewed: October 2026. Review every few months: names and
// purposes change. Meta's crawlers are left out because their documentation needs a login to read.

export type Category = "ai-search" | "user" | "training" | "token" | "search";

export type Bot = { token: string; company: string; category: Category; what: string; docs: string };

const OPENAI = "https://platform.openai.com/docs/bots";
const ANTHROPIC = "https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler";
const PERPLEXITY = "https://docs.perplexity.ai/guides/bots";
const GOOGLE = "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers";
const APPLE = "https://support.apple.com/en-us/119829";
const AMAZON = "https://developer.amazon.com/amazonbot";

export const LAST_REVIEWED = "October 2026";

export const BOTS: Bot[] = [
  { token: "OAI-SearchBot", company: "OpenAI", category: "ai-search", docs: OPENAI,
    what: "Finds pages to show in ChatGPT search answers. If it's blocked, your site won't show up in ChatGPT search results." },
  { token: "ChatGPT-User", company: "OpenAI", category: "user", docs: OPENAI,
    what: "Visits a page when someone asks ChatGPT about it. OpenAI says robots.txt may not apply to these visits, since a person asked for them." },
  { token: "GPTBot", company: "OpenAI", category: "training", docs: OPENAI,
    what: "Collects pages that may be used to train OpenAI's models. Blocking it opts you out of training, not out of ChatGPT search." },
  { token: "Claude-SearchBot", company: "Anthropic", category: "ai-search", docs: ANTHROPIC,
    what: "Indexes pages to improve Claude's search results. If it's blocked, your site can be less visible in Claude's answers." },
  { token: "Claude-User", company: "Anthropic", category: "user", docs: ANTHROPIC,
    what: "Visits a page when someone asks Claude a question." },
  { token: "ClaudeBot", company: "Anthropic", category: "training", docs: ANTHROPIC,
    what: "Collects pages that may be used to train Anthropic's models." },
  { token: "PerplexityBot", company: "Perplexity", category: "ai-search", docs: PERPLEXITY,
    what: "Finds and links pages in Perplexity's answers. Perplexity says it isn't used to train AI models." },
  { token: "Perplexity-User", company: "Perplexity", category: "user", docs: PERPLEXITY,
    what: "Visits a page when someone asks Perplexity a question." },
  { token: "Amzn-SearchBot", company: "Amazon", category: "ai-search", docs: AMAZON,
    what: "Improves search in Amazon's products and services." },
  { token: "Amazonbot", company: "Amazon", category: "training", docs: AMAZON,
    what: "Helps improve Amazon's products, and may be used to train Amazon's AI models." },
  { token: "Googlebot", company: "Google", category: "search", docs: GOOGLE,
    what: "Google's main crawler for Search, including AI Overviews. Blocking it takes you out of Google." },
  { token: "Google-Extended", company: "Google", category: "token", docs: GOOGLE,
    what: "Not a crawler. It tells Google whether your pages can be used to train Gemini and to ground Gemini's answers. It doesn't affect Google Search or rankings." },
  { token: "Bingbot", company: "Microsoft", category: "search", docs: "https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0",
    what: "Bing's crawler. Bing's search index also feeds Microsoft Copilot's web answers." },
  { token: "Applebot", company: "Apple", category: "search", docs: APPLE,
    what: "Powers results in Siri, Spotlight and Safari, and may give Apple's AI features up-to-date context." },
  { token: "Applebot-Extended", company: "Apple", category: "token", docs: APPLE,
    what: "Not a crawler. It tells Apple whether your pages can be used to train its AI models." },
  { token: "CCBot", company: "Common Crawl", category: "training", docs: "https://commoncrawl.org/ccbot",
    what: "Builds Common Crawl's free public web archive, which is widely used as AI training data." },
];

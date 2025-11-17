// backend/cloudflare-worker.js
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

export default {
  async fetch(request, env, ctx) {
    // Obsługa CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    const urlObj = new URL(request.url);
    const path = urlObj.pathname;

    // Nowy endpoint: /send-to-kindle
    if (path === '/send-to-kindle' && request.method === 'POST') {
      return handleSendToKindle(request, env);
    }

    // Istniejący endpoint: ekstrakcja artykułów
    const targetUrl = urlObj.searchParams.get('url');

    if (!targetUrl) {
      return json({ error: 'Missing url param' }, 400);
    }
    if (!isValidHttpUrl(targetUrl)) {
      return json({ error: 'Invalid url' }, 400);
    }

    try {
      const res = await fetch(targetUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        redirect: 'follow',
      });

      if (!res.ok) {
        return json({ error: `Upstream error: ${res.status}` }, res.status);
      }

      const html = await res.text();
      const parsed = extractArticle(html, targetUrl);

      return json(parsed, 200, {
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      });
    } catch (e) {
      return json({ error: e.toString() }, 500);
    }
  },
};

// Nowa funkcja: wysyłanie ePub na Kindle przez Resend
async function handleSendToKindle(request, env) {
  try {
    const formData = await request.formData();
    const epubFile = formData.get('epub');
    const userEmail = formData.get('userEmail');
    const kindleEmail = formData.get('kindleEmail');
    const bookTitle = formData.get('bookTitle') || 'Book';

    // Walidacja
if (!epubFile || !userEmail || !kindleEmail) {
  return json({ error: 'Missing required fields' }, 400, {
    'Access-Control-Allow-Origin': '*',
  });
}

if (!env.RESEND_API_KEY) {
  return json({ error: 'Server configuration error: missing API key' }, 500, {
    'Access-Control-Allow-Origin': '*',
  });
}

    // Konwersja pliku do base64
    const arrayBuffer = await epubFile.arrayBuffer();
    const base64Content = arrayBufferToBase64(arrayBuffer);

    // Wysyłka przez Resend API
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `onboarding@resend.dev`, // Zmień na swoją zweryfikowaną domenę
        to: [kindleEmail],
        reply_to: userEmail,
        subject: bookTitle,
        text: `ePub book: ${bookTitle}\n\nSent from ePub App`,
        attachments: [
          {
            filename: `${sanitizeFilename(bookTitle)}.epub`,
            content: base64Content,
          },
        ],
      }),
    });

    const result = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error('Resend API error:', result);
      return json({ 
        error: 'Failed to send email', 
        details: result 
      }, resendResponse.status, {
        'Access-Control-Allow-Origin': '*',
      });
    }

    return json({ 
      success: true, 
      messageId: result.id 
    }, 200, {
      'Access-Control-Allow-Origin': '*',
    });

  } catch (e) {
    console.error('Send to Kindle error:', e);
    return json({ error: e.toString() }, 500, {
      'Access-Control-Allow-Origin': '*',
    });
  }
}

// Konwersja ArrayBuffer do base64
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Sanityzacja nazwy pliku
function sanitizeFilename(name) {
  return name
    .replace(/[^a-z0-9_\-\.]/gi, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 100);
}

function isValidHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

// Ekstrakcja artykułu z użyciem Mozilla Readability
function extractArticle(html, baseUrl) {
  try {
    // Parsuj HTML za pomocą linkedom (DOM dla Node.js/Workers)
    const { document } = parseHTML(html);
    
    // Wyciągnij metadane z meta tagów przed Readability
    const metadata = extractMetadata(document, baseUrl);
    
    // Ustaw baseURI dla dokumentu (dla absolutyzacji URL-i)
    document.documentURI = baseUrl;
    
    // Użyj Readability do ekstrakcji treści
    const reader = new Readability(document, {
      debug: false,
      charThreshold: 500, // Minimalny próg znaków dla artykułu
    });
    
    const article = reader.parse();
    
    if (!article) {
      // Fallback: jeśli Readability nie znalazł artykułu
      return {
        title: metadata.title || 'Untitled',
        author: metadata.author || '',
        excerpt: metadata.excerpt || '',
        siteName: metadata.siteName || '',
        publishedTime: metadata.publishedTime || '',
        contentHTML: '<p>Could not extract article content.</p>',
        textContent: '',
        length: 0,
        lang: metadata.lang || 'en',
      };
    }
    
    // Absolutyzacja URL-i w treści
    const absolutizedContent = absolutizeUrls(article.content, baseUrl);
    
    return {
      title: article.title || metadata.title || 'Untitled',
      author: article.byline || metadata.author || '',
      excerpt: article.excerpt || metadata.excerpt || '',
      siteName: article.siteName || metadata.siteName || '',
      publishedTime: metadata.publishedTime || '',
      contentHTML: absolutizedContent,
      textContent: article.textContent || '',
      length: article.length || 0,
      lang: metadata.lang || 'en',
    };
  } catch (e) {
    console.error('Readability error:', e);
    // Fallback do prostej ekstrakcji
    return fallbackExtraction(html, baseUrl);
  }
}

// Wyciągnij metadane z meta tagów (Open Graph, Twitter Cards, itp.)
function extractMetadata(document, baseUrl) {
  const getMeta = (selectors) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const content = el.getAttribute('content') || el.getAttribute('value');
        if (content) return content.trim();
      }
    }
    return '';
  };
  
  return {
    title: getMeta([
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[name="title"]',
    ]) || document.querySelector('title')?.textContent?.trim() || '',
    
    author: getMeta([
      'meta[name="author"]',
      'meta[property="article:author"]',
      'meta[name="twitter:creator"]',
    ]),
    
    excerpt: getMeta([
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[name="description"]',
    ]),
    
    siteName: getMeta([
      'meta[property="og:site_name"]',
      'meta[name="application-name"]',
    ]) || new URL(baseUrl).hostname,
    
    publishedTime: getMeta([
      'meta[property="article:published_time"]',
      'meta[name="publish_date"]',
      'meta[name="date"]',
    ]),
    
    lang: document.documentElement?.getAttribute('lang') || 
          getMeta(['meta[http-equiv="content-language"]']) || 
          'en',
  };
}

// Absolutyzacja URL-i (src, href)
function absolutizeUrls(html, baseUrl) {
  const u = new URL(baseUrl);
  return html.replace(/(src|href)\s*=\s*"(.*?)"/gi, (match, attr, val) => {
    if (/^https?:\/\//i.test(val) || /^data:/i.test(val) || /^mailto:/i.test(val)) {
      return match;
    }
    if (val.startsWith('//')) {
      return `${attr}="${u.protocol}${val}"`;
    }
    if (val.startsWith('/')) {
      return `${attr}="${u.origin}${val}"`;
    }
    // Ścieżki względne
    try {
      const resolved = new URL(val, u).href;
      return `${attr}="${resolved}"`;
    } catch {
      return match;
    }
  });
}

// Fallback: prosta ekstrakcja (jak w oryginalnym kodzie)
function fallbackExtraction(html, baseUrl) {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const titleMatch = cleaned.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeHtml(titleMatch[1]).trim() : 'Untitled';

  const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyInner = bodyMatch ? bodyMatch[1] : cleaned;

  const absolutized = absolutizeUrls(bodyInner, baseUrl);

  return {
    title,
    author: '',
    excerpt: '',
    siteName: new URL(baseUrl).hostname,
    publishedTime: '',
    contentHTML: absolutized,
    textContent: stripTags(absolutized),
    length: stripTags(absolutized).length,
    lang: 'en',
  };
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtml(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
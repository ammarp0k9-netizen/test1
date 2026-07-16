window.words = [];
let currentFilter = 'all';

// فتح وإغلاق القائمة الجانبية
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('show');
}

// إضافة كلمة
async function addWord() {
  const w = document.getElementById('wordInput').value.trim();
  const m = document.getElementById('meaningInput').value.trim();
  const ex = document.getElementById('exampleInput').value.trim();
  const c = document.getElementById('categoryInput').value;

  if (!w || !m) return alert("اكتب الكلمة ومعناها!");

  const newWord = { text: w, meaning: m, example: ex, category: c, starred: false };
  
  if (window.auth && window.auth.currentUser) {
    await window.dbAdd(newWord);
  } else {
    window.words.unshift({ id: Date.now().toString(), ...newWord });
    render();
  }

  document.getElementById('wordInput').value = '';
  document.getElementById('meaningInput').value = '';
  document.getElementById('exampleInput').value = '';
}

// حذف كلمة
async function deleteWord(id) {
  if (confirm("تحذف الكلمة يا أسطورة؟")) {
    if (window.auth && window.auth.currentUser) {
      await window.dbDelete(id);
    } else {
      window.words = window.words.filter(w => w.id !== id);
      render();
    }
  }
}

// تشغيل الصوت (الطريقة القانونية والأسرع)
function playSound(text) {
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'en-US';
  window.speechSynthesis.speak(utt);
}

// جلب المعاني بالذكاء الاصطناعي
async function fetchSuggestions() {
  const word = document.getElementById('wordInput').value.trim();
  if (!word) return alert("اكتب كلمة بالإنجليزي أولاً!");
  
  const btn = document.getElementById('searchBtn');
  btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i>";
  
  try {
    const res = await fetch("https://dictionary7-ayes.onrender.com/api/dictionary", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word })
    });
    const data = await res.json();
    const text = data.choices[0].message.content;
    const suggestions = JSON.parse(text.substring(text.indexOf('['), text.lastIndexOf(']') + 1));
    
    // أخذ أول وأفضل معنى لتبسيط الواجهة
    document.getElementById('meaningInput').value = suggestions[0].ar;
    document.getElementById('exampleInput').value = suggestions[0].ex;
    document.getElementById('categoryInput').value = suggestions[0].pos;
    
  } catch (err) {
    alert("تأكد إن السيرفر شغال!");
  } finally {
    btn.innerHTML = "<i class='fas fa-search'></i>";
  }
}

// تصفية وعرض الكلمات
function setFilter(f) {
  currentFilter = f;
  document.getElementById('toolAll').classList.toggle('active-tool', f === 'all');
  document.getElementById('toolStarred').classList.toggle('active-tool', f === 'starred');
  render();
}

function render() {
  const query = document.getElementById('searchInput').value.toLowerCase();
  
  let filtered = window.words.filter(w => {
    const match = w.text.toLowerCase().includes(query) || w.meaning.toLowerCase().includes(query);
    return match && (currentFilter === 'all' || w.starred);
  });

  document.getElementById('list').innerHTML = filtered.map(w => `
    <li>
      <div>
        <div class="word-text">${w.text} <span style="font-size:11px; color:#3b82f6;">(${w.category})</span></div>
        <div class="meaning-text">${w.meaning}</div>
      </div>
      <div class="actions">
        <i class="fas fa-volume-up" onclick="playSound('${w.text}')"></i>
        <i class="fas fa-trash" onclick="deleteWord('${w.id}')"></i>
      </div>
    </li>
  `).join('');
  
  document.getElementById('totalCount').innerText = `إجمالي الكلمات: ${window.words.length}`;
}
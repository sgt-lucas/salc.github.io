document.addEventListener('DOMContentLoaded', () => {
    // ========================================================================
    // 1. CONFIGURAÇÃO INICIAL E ESTADO DA APLICAÇÃO
    // ========================================================================

    // ATENÇÃO: PASSO CRUCIAL APÓS O DEPLOY DO BACKEND
    // Substitua a URL abaixo pela URL real da sua API fornecida pela Render.
    const API_URL = 'https://salc.onrender.com';

    const accessToken = localStorage.getItem('accessToken');
    let currentUser = null; // Armazenará { username, role, ... }
    let appState = { // Armazena os dados principais para evitar requisições repetidas
        secoes: [],
        planosInternos: [],
        naturezasDespesa: [],
        notasCredito: [],
    };

    // ========================================================================
    // 2. INICIALIZAÇÃO E AUTENTICAÇÃO
    // ========================================================================

    async function initApp() {
        if (!accessToken) {
            window.location.href = 'login.html';
            return;
        }

        try {
            currentUser = await fetchWithAuth('/users/me');
            document.getElementById('app-main').innerHTML = `<div class="loading-spinner"><p>Carregando aplicação...</p></div>`;
            renderAppLayout();
            renderDashboardView(); // A view inicial é o Dashboard
        } catch (error) {
            console.error('Falha na autenticação ou inicialização:', error);
            logout();
        }
    }

    function logout() {
        localStorage.removeItem('accessToken');
        window.location.href = 'login.html';
    }

    // ========================================================================
    // 3. FUNÇÃO AUXILIAR PARA REQUISIÇÕES À API
    // ========================================================================

    async function fetchWithAuth(endpoint, options = {}) {
        const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}`, ...options.headers };
        const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });

        if (response.status === 401) { logout(); throw new Error('Sessão expirada.'); }
        if (!response.ok) { const errorData = await response.json(); throw new Error(errorData.detail || 'Ocorreu um erro na requisição.'); }
        return response.status === 204 ? null : response.json();
    }

    // ========================================================================
    // 4. RENDERIZAÇÃO DA INTERFACE (LAYOUT E NAVEGAÇÃO)
    // ========================================================================

    function renderAppLayout() {
        // Renderiza o cabeçalho com o nome do usuário
        const usernameDisplay = document.getElementById('username-display');
        usernameDisplay.textContent = `Usuário: ${currentUser.username} (${currentUser.role})`;
        document.getElementById('logout-btn').addEventListener('click', logout);
        
        // Renderiza a navegação principal (abas)
        const navContainer = document.getElementById('app-nav');
        let navHTML = `
            <button class="tab-btn active" data-view="dashboard">Dashboard</button>
            <button class="tab-btn" data-view="notasCredito">Notas de Crédito</button>
            <button class="tab-btn" data-view="empenhos">Empenhos</button>
        `;

        if (currentUser.role === 'ADMINISTRADOR') {
            navHTML += `<button class="tab-btn" data-view="admin">Administração</button>`;
        }
        
        navContainer.innerHTML = navHTML;

        // Adiciona os event listeners para as abas
        navContainer.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                
                const view = e.target.dataset.view;
                // Lógica para carregar a view correspondente
                // Ex: if (view === 'dashboard') renderDashboardView();
                alert(`Navegando para a visão: ${view}`); // Placeholder
            }
        });
    }

    // ========================================================================
    // 5. LÓGICA DAS VIEWS (Exemplo: Dashboard)
    // ========================================================================

    async function renderDashboardView() {
        const mainContainer = document.getElementById('app-main');
        mainContainer.innerHTML = `<div class="loading-spinner"><p>Carregando Dashboard...</p></div>`;

        try {
            // Em um sistema real, aqui você faria uma requisição para um endpoint /dashboard
            const dashboardData = {
                saldoDisponivel: 1234567.89,
                totalEmpenhado: 765432.11,
                ncsAtivas: 42,
                avisos: [{ numero_nc: '2025NC00123', prazo_empenho: '2025-09-13' }],
                saldoPorSecao: {
                    labels: ['Seção Contratos', 'Seção TI', 'Seção Infra'],
                    data: [500000, 350000, 384567]
                }
            };

            const avisosHTML = dashboardData.avisos.map(aviso => 
                `<p class="aviso-item"><strong>NC ${aviso.numero_nc}:</strong> Vence em breve (${new Date(aviso.prazo_empenho).toLocaleDateString('pt-BR')})!</p>`
            ).join('');

            mainContainer.innerHTML = `
                <h1>Dashboard</h1>
                <div class="dashboard-grid">
                    <div class="card kpi-card">
                        <h3>Saldo Disponível Total</h3>
                        <p>${dashboardData.saldoDisponivel.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                    </div>
                    <div class="card kpi-card">
                        <h3>Total Empenhado</h3>
                        <p>${dashboardData.totalEmpenhado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                    </div>
                    <div class="card kpi-card">
                        <h3>NCs Ativas</h3>
                        <p>${dashboardData.ncsAtivas}</p>
                    </div>
                </div>
                <div class="card aviso-card">
                    <h3><i class="fas fa-exclamation-triangle"></i> Avisos Importantes</h3>
                    ${avisosHTML.length > 0 ? avisosHTML : '<p>Nenhum aviso no momento.</p>'}
                </div>
                <div class="card chart-card">
                    <h3>Saldo por Seção</h3>
                    <canvas id="grafico-secoes"></canvas>
                </div>
            `;

            renderChart('grafico-secoes', dashboardData.saldoPorSecao.labels, dashboardData.saldoPorSecao.data);
        } catch (error) {
            mainContainer.innerHTML = `<p class="error-message">Não foi possível carregar o dashboard: ${error.message}</p>`;
        }
    }

    function renderChart(canvasId, labels, data) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Saldo Disponível (R$)',
                    data: data,
                    backgroundColor: 'rgba(0, 51, 102, 0.7)',
                    borderColor: 'rgba(0, 51, 102, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true } },
                plugins: { legend: { display: false } }
            }
        });
    }

    // A implementação das outras views (renderNotasCreditoView, renderAdminView, etc.)
    // seguiria um padrão similar: limpar o container principal, buscar dados e
    // construir o HTML necessário (filtros, botões, tabelas).

    // ========================================================================
    // 6. INICIALIZAÇÃO DA APLICAÇÃO
    // ========================================================================
    initApp();
});

document.addEventListener('DOMContentLoaded', () => {
    // ========================================================================
    // 1. CONFIGURAÇÃO INICIAL E ESTADO DA APLICAÇÃO
    // ========================================================================

    // ATENÇÃO: PASSO CRUCIAL APÓS O DEPLOY DO BACKEND
    // Substitua a URL abaixo pela URL real da sua API fornecida pela Render.
    const API_URL = 'https://sua-api-aqui.onrender.com';

    const accessToken = localStorage.getItem('accessToken');
    let currentUser = null; // Armazenará os dados do usuário logado (incluindo o perfil)

    // ========================================================================
    // 2. AUTENTICAÇÃO E LÓGICA PRINCIPAL
    // ========================================================================

    // Função principal que inicia a aplicação
    async function initApp() {
        if (!accessToken) {
            window.location.href = 'login.html';
            return;
        }

        try {
            currentUser = await fetchWithAuth('/users/me');
            renderApp(); // Se o token for válido e o usuário for encontrado, renderiza a aplicação
        } catch (error) {
            console.error('Falha na autenticação:', error);
            logout(); // Se o token for inválido, limpa e redireciona para o login
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
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            ...options.headers,
        };

        const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });

        if (response.status === 401) { // Token expirado ou inválido
            logout();
            throw new Error('Sessão expirada.');
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Ocorreu um erro na requisição.');
        }
        
        // Retorna null para respostas sem conteúdo (ex: DELETE 204)
        return response.status === 204 ? null : response.json();
    }

    // ========================================================================
    // 4. RENDERIZAÇÃO DA INTERFACE
    // ========================================================================

    // Função que constrói a página inteira
    function renderApp() {
        const appContainer = document.getElementById('app-container');
        if (!appContainer) return;

        // Renderiza o cabeçalho com o nome do usuário
        const usernameDisplay = document.getElementById('username-display');
        if (usernameDisplay) {
            usernameDisplay.textContent = `Usuário: ${currentUser.username} (${currentUser.role})`;
        }
        document.getElementById('logout-btn').addEventListener('click', logout);
        
        // Renderiza a navegação principal
        renderNavigation();
        
        // Por padrão, carrega o dashboard
        renderDashboardView();
    }

    function renderNavigation() {
        const navContainer = document.querySelector('.app-nav');
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
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                
                const view = e.target.dataset.view;
                switch (view) {
                    case 'dashboard':
                        renderDashboardView();
                        break;
                    // Adicionar casos para outras views aqui
                }
            });
        });
    }

    async function renderDashboardView() {
        const mainContainer = document.getElementById('app-main');
        mainContainer.innerHTML = `<div class="loading-spinner"><p>Carregando Dashboard...</p></div>`;

        // Aqui viria a lógica para buscar os dados dos KPIs, Avisos e Gráficos
        // Exemplo simplificado:
        mainContainer.innerHTML = `
            <h1>Dashboard</h1>
            <div class="dashboard-grid">
                <div class="card">
                    <h3>Saldo Disponível Total</h3>
                    <p>R$ 1.234.567,89</p>
                </div>
                <div class="card">
                    <h3>Total Empenhado</h3>
                    <p>R$ 765.432,11</p>
                </div>
                <div class="card">
                    <h3>NCs Ativas</h3>
                    <p>42</p>
                </div>
            </div>
            <div class="card" style="margin-top: 20px;">
                <h3>Avisos Importantes</h3>
                <p><strong>NC 2025NC00123:</strong> Vence em 3 dias!</p>
            </div>
            <div class="card" style="margin-top: 20px;">
                <h3>Saldo por Seção</h3>
                <canvas id="grafico-secoes"></canvas>
            </div>
        `;

        // Lógica para renderizar o gráfico
        const ctx = document.getElementById('grafico-secoes').getContext('2d');
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Seção Contratos', 'Seção TI', 'Seção Infra'],
                datasets: [{
                    label: 'Saldo Disponível (R$)',
                    data: [500000, 350000, 384567],
                    backgroundColor: 'rgba(0, 51, 102, 0.7)',
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    // --- CHAMADA INICIAL ---
    initApp();
});

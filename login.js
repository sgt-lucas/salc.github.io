document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const errorMessage = document.getElementById('error-message');

    // ========================================================================
    // ATENÇÃO: PASSO CRUCIAL APÓS O DEPLOY DO BACKEND
    // Substitua a URL abaixo pela URL real da sua API fornecida pela Render.
    // ========================================================================
    const API_URL = 'https://sua-api-aqui.onrender.com';

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorMessage.textContent = '';
        const submitButton = loginForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.textContent = 'Autenticando...';

        const username = e.target.username.value;
        const password = e.target.password.value;

        // O FastAPI espera os dados de login no formato 'form data', não JSON.
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);

        try {
            const response = await fetch(`${API_URL}/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData,
            });

            const data = await response.json();

            if (!response.ok) {
                // Se a resposta não for bem-sucedida, lança um erro com a mensagem da API
                throw new Error(data.detail || 'Falha na autenticação');
            }

            // Se a autenticação for bem-sucedida, armazena o token de acesso
            localStorage.setItem('accessToken', data.access_token);
            
            // Redireciona o usuário para a página principal do sistema
            window.location.href = 'index.html';

        } catch (error) {
            errorMessage.textContent = `Erro: ${error.message}`;
        } finally {
            // Reabilita o botão
            submitButton.disabled = false;
            submitButton.textContent = 'Entrar';
        }
    });
});

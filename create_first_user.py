import os
import getpass
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import IntegrityError

# Importa os modelos e utilitários definidos no main.py
# Isso garante que estamos usando a mesma estrutura de banco de dados e de hashing.
from main import User, UserRole, get_password_hash, SessionLocal, engine, Base

def create_admin_user():
    """
    Script interativo para criar o primeiro usuário administrador do sistema.
    """
    print("--- Criação do Usuário Administrador Inicial ---")
    print("Este script deve ser executado apenas uma vez para configurar o sistema.")
    
    # Cria a sessão com o banco de dados
    db = SessionLocal()
    
    try:
        # Pede as informações do usuário de forma interativa
        username = input("Digite o nome de usuário para o Administrador: ").strip()
        email = input(f"Digite o e-mail para o usuário '{username}': ").strip()
        
        # Pede a senha de forma segura, sem exibi-la na tela
        password = getpass.getpass("Digite a senha para o Administrador: ")
        password_confirm = getpass.getpass("Confirme a senha: ")

        if password != password_confirm:
            print("\nERRO: As senhas não coincidem. Operação cancelada.")
            return

        if not all([username, email, password]):
            print("\nERRO: Todos os campos são obrigatórios. Operação cancelada.")
            return

        # Verifica se o usuário ou e-mail já existem
        existing_user = db.query(User).filter((User.username == username) | (User.email == email)).first()
        if existing_user:
            print(f"\nERRO: O nome de usuário '{username}' ou o e-mail '{email}' já existe no banco de dados. Operação cancelada.")
            return
            
        # Cria o hash da senha
        hashed_password = get_password_hash(password)
        
        # Cria a nova instância do usuário com o perfil de Administrador
        admin_user = User(
            username=username,
            email=email,
            hashed_password=hashed_password,
            role=UserRole.ADMINISTRADOR
        )
        
        db.add(admin_user)
        db.commit()
        
        print("\n----------------------------------------------------")
        print(f"SUCESSO! Usuário Administrador '{username}' criado.")
        print("----------------------------------------------------")

    except IntegrityError:
        db.rollback()
        print("\nERRO: Ocorreu um erro de integridade. O usuário ou e-mail já pode existir.")
    except Exception as e:
        db.rollback()
        print(f"\nERRO: Uma exceção inesperada ocorreu: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    # Garante que as tabelas existam antes de tentar inserir dados
    print("Verificando se as tabelas do banco de dados existem...")
    Base.metadata.create_all(bind=engine)
    print("Verificação concluída.")
    
    create_admin_user()
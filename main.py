# main.py
import os
import io
import enum
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, status, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import create_engine, Column, Integer, String, Float, Date, ForeignKey, DateTime, Enum as SQLAlchemyEnum, desc
from sqlalchemy.orm import sessionmaker, Session, relationship, DeclarativeBase
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql import func

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch

app = FastAPI(title="Sistema de Gestão de Notas de Crédito", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

if SECRET_KEY is None:
    raise RuntimeError("FATAL: A variável de ambiente SECRET_KEY não está configurada.")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL is None:
    raise RuntimeError("FATAL: A variável de ambiente DATABASE_URL não está configurada.")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

class UserRole(str, enum.Enum):
    OPERADOR = "OPERADOR"
    ADMINISTRADOR = "ADMINISTRADOR"

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(SQLAlchemyEnum(UserRole), nullable=False, default=UserRole.OPERADOR)

class Seção(Base):
    __tablename__ = "secoes"
    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, unique=True, nullable=False)
    notas_credito = relationship("NotaCredito", back_populates="secao_responsavel")
    empenhos = relationship("Empenho", back_populates="secao_requisitante")

class NotaCredito(Base):
    __tablename__ = "notas_credito"
    id = Column(Integer, primary_key=True, index=True)
    numero_nc = Column(String, unique=True, nullable=False, index=True)
    valor = Column(Float, nullable=False)
    esfera = Column(String)
    fonte = Column(String(10))
    ptres = Column(String(6))
    plano_interno = Column(String, index=True)
    nd = Column(String(6), index=True)
    data_chegada = Column(Date)
    prazo_empenho = Column(Date)
    descricao = Column(String, nullable=True)
    secao_responsavel_id = Column(Integer, ForeignKey("secoes.id"), index=True)
    saldo_disponivel = Column(Float, nullable=False)
    status = Column(String, default="Ativa", index=True)
    
    secao_responsavel = relationship("Seção", back_populates="notas_credito")
    empenhos = relationship("Empenho", back_populates="nota_credito", cascade="all, delete-orphan")
    recolhimentos = relationship("RecolhimentoSaldo", back_populates="nota_credito", cascade="all, delete-orphan")

class Empenho(Base):
    __tablename__ = "empenhos"
    id = Column(Integer, primary_key=True, index=True)
    numero_ne = Column(String, unique=True, nullable=False, index=True)
    valor = Column(Float, nullable=False)
    data_empenho = Column(Date)
    observacao = Column(String, nullable=True)
    nota_credito_id = Column(Integer, ForeignKey("notas_credito.id"))
    secao_requisitante_id = Column(Integer, ForeignKey("secoes.id"))
    
    nota_credito = relationship("NotaCredito", back_populates="empenhos")
    secao_requisitante = relationship("Seção", back_populates="empenhos")
    anulacoes = relationship("AnulacaoEmpenho", back_populates="empenho", cascade="all, delete-orphan")

class AnulacaoEmpenho(Base):
    __tablename__ = "anulacoes_empenho"
    id = Column(Integer, primary_key=True, index=True)
    empenho_id = Column(Integer, ForeignKey("empenhos.id"))
    valor = Column(Float, nullable=False)
    data = Column(Date, nullable=False)
    observacao = Column(String, nullable=True)
    
    empenho = relationship("Empenho", back_populates="anulacoes")

class RecolhimentoSaldo(Base):
    __tablename__ = "recolhimentos_saldo"
    id = Column(Integer, primary_key=True, index=True)
    nota_credito_id = Column(Integer, ForeignKey("notas_credito.id"))
    valor = Column(Float, nullable=False)
    data = Column(Date, nullable=False)
    observacao = Column(String, nullable=True)
    
    nota_credito = relationship("NotaCredito", back_populates="recolhimentos")

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    username = Column(String, nullable=False)
    action = Column(String, nullable=False)
    details = Column(String, nullable=True)

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    role: UserRole

class UserInDB(BaseModel):
    id: int
    username: str
    email: EmailStr
    role: UserRole

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class SeçãoCreate(BaseModel):
    nome: str

class SeçãoInDB(BaseModel):
    id: int
    nome: str

    class Config:
        from_attributes = True

class NotaCreditoCreate(BaseModel):
    numero_nc: str
    valor: float = Field(ge=0)
    esfera: str
    fonte: str
    ptres: str
    plano_interno: str
    nd: str
    data_chegada: date
    prazo_empenho: date
    descricao: Optional[str] = None
    secao_responsavel_id: int
    saldo_disponivel: float = Field(ge=0)

class NotaCreditoInDB(BaseModel):
    id: int
    numero_nc: str
    valor: float
    esfera: str
    fonte: str
    ptres: str
    plano_interno: str
    nd: str
    data_chegada: date
    prazo_empenho: date
    descricao: Optional[str]
    secao_responsavel_id: int
    secao_responsavel: SeçãoInDB
    saldo_disponivel: float
    status: str

    class Config:
        from_attributes = True

class EmpenhoCreate(BaseModel):
    numero_ne: str
    valor: float = Field(ge=0)
    data_empenho: date
    observacao: Optional[str] = None
    nota_credito_id: int
    secao_requisitante_id: int

class EmpenhoInDB(BaseModel):
    id: int
    numero_ne: str
    valor: float
    data_empenho: date
    observacao: Optional[str]
    nota_credito_id: int
    secao_requisitante_id: int

    class Config:
        from_attributes = True

class AnulacaoEmpenhoCreate(BaseModel):
    empenho_id: int
    valor: float = Field(ge=0)
    data: date
    observacao: Optional[str] = None

class AnulacaoEmpenhoInDB(BaseModel):
    id: int
    empenho_id: int
    valor: float
    data: date
    observacao: Optional[str]

    class Config:
        from_attributes = True

class RecolhimentoSaldoCreate(BaseModel):
    nota_credito_id: int
    valor: float = Field(ge=0)
    data: date
    observacao: Optional[str] = None

class RecolhimentoSaldoInDB(BaseModel):
    id: int
    nota_credito_id: int
    valor: float
    data: date
    observacao: Optional[str]

    class Config:
        from_attributes = True

class AuditLogInDB(BaseModel):
    id: int
    timestamp: datetime
    username: str
    action: str
    details: Optional[str]

    class Config:
        from_attributes = True

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict):
    to_encode = data.copy()
   
